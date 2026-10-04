import type {
  GithubRepository,
  GithubRepoSnapshot,
  MyosEvidenceInput,
} from '@career-os/shared';
import type { GithubClient, RawRepo } from './client';
import { AuthError, RateLimitError, sanitizeErrorMessage } from './errors';
import { normalizeRepository } from './normalize';
import { cleanText } from './text';

export type GithubSyncRunStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

/**
 * Persistence seam. apps/web/lib/myos-github-store.ts implements this with thin adapters over
 * packages/database/src/queries/myos-github.ts / myos-evidence.ts (service-role client + userId
 * bound, because only the service role may write VERIFIED evidence / GITHUB_* sources):
 *
 *  - listRepositories         -> listOwnGithubRepositories(supabase, userId)
 *  - upsertRepositorySnapshot -> upsertGithubRepositorySnapshot(supabase, userId, snapshot)
 *        (idempotent on (user_id, github_repo_id); never touches selected/project_id)
 *  - markRepositorySyncError  -> markOwnGithubRepositorySyncError(supabase, userId, repoRowId, msg)
 *  - startSyncRun             -> startOwnGithubSyncRun(supabase, userId)
 *  - finishSyncRun            -> finishOwnGithubSyncRun(supabase, userId, runId, {status, stats, error})
 *  - upsertEvidenceBySource   -> upsertOwnEvidenceBySource(supabase, userId, input)
 *        (keyed on (user_id, source_type, source_ref); never lowers verification or visibility;
 *        the adapter derives `created` from createdAt === updatedAt)
 *
 * Every adapter call is user-scoped; user_id never comes from GitHub or request data.
 */
export interface GithubSyncStore {
  listRepositories(userId: string): Promise<GithubRepository[]>;
  upsertRepositorySnapshot(userId: string, snapshot: GithubRepoSnapshot): Promise<void>;
  /** `repoRowId` is github_repositories.id (the row uuid), not the numeric GitHub id. */
  markRepositorySyncError(
    userId: string,
    repoRowId: string,
    message: string,
  ): Promise<void>;
  startSyncRun(userId: string): Promise<{ id: string }>;
  finishSyncRun(
    userId: string,
    runId: string,
    result: {
      status: GithubSyncRunStatus;
      stats: Record<string, unknown>;
      error: string | null;
    },
  ): Promise<void>;
  upsertEvidenceBySource(
    userId: string,
    input: MyosEvidenceInput,
  ): Promise<{ id: string; created: boolean }>;
  /**
   * Repo rename: re-keys evidence (GITHUB_REPO/GITHUB_README `old`, GITHUB_PR `old#N`) to the new
   * full name instead of leaving orphans and creating duplicates. Optional: when absent a rename
   * produces fresh evidence under the new name (documented limitation).
   */
  renameRepositoryEvidence?(
    userId: string,
    oldFullName: string,
    newFullName: string,
  ): Promise<void>;
}

export type SyncClient = Pick<
  GithubClient,
  | 'listRepositories'
  | 'getRepository'
  | 'getLanguages'
  | 'getReadme'
  | 'getContributors'
  | 'countPullRequests'
  | 'countCommits'
  | 'listMergedPullRequests'
>;

export const OWNERSHIP_UNVERIFIED_NOTE = 'ownership unverified';

export interface GithubSyncStats {
  reposListed: number;
  metadataUpserted: number;
  detailSynced: number;
  skippedUnchanged: number;
  failed: number;
  evidenceCreated: number;
  evidenceUpdated: number;
  rateLimited: boolean;
  rateLimitResetAt: string | null;
  /** False for username-only connections: evidence is USER_PROVIDED and PR sampling is skipped. */
  ownershipVerified: boolean;
  /** UI-facing note; 'ownership unverified' when the connection has no validated token. */
  ownershipNote: string | null;
  /** Repos not started because the time budget ran out; picked up by the next run. */
  deferred: number;
}

export interface GithubSyncResult {
  runId: string;
  status: GithubSyncRunStatus;
  stats: GithubSyncStats;
  error: string | null;
}

export interface SyncParams {
  store: GithubSyncStore;
  client: SyncClient;
  userId: string;
  login: string;
  now?: () => Date;
  /**
   * True only when a token was validated as belonging to `login` (GET /user at connect time).
   * Without it nobody has proven the user owns that GitHub login: evidence is USER_PROVIDED and
   * the authored-PR search (an authorship claim) is skipped.
   */
  ownershipVerified: boolean;
  /** Max repos processed in parallel (default 3). */
  concurrency?: number;
  /** Stop starting new repos after this many ms (default 45s; run ends PARTIAL). */
  maxElapsedMs?: number;
  /** Millisecond clock, injectable for tests. */
  clock?: () => number;
}

export const DEFAULT_SYNC_CONCURRENCY = 3;
export const DEFAULT_SYNC_BUDGET_MS = 45_000;

const README_EXCERPT_CHARS = 2000;

/** DB timestamps may come back as `+00:00`; compare instants, not strings. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function listingChanged(ex: GithubRepository, raw: RawRepo): boolean {
  return (
    !sameInstant(ex.pushedAt, raw.pushed_at ?? null) ||
    ex.description !== cleanText(raw.description, 2000) ||
    ex.stars !== raw.stargazers_count ||
    ex.isArchived !== raw.archived ||
    ex.isPrivate !== raw.private
  );
}

/**
 * Listing-only snapshot. The DB upsert writes every column, so previously fetched detail is carried
 * over from the existing row; etag is cleared so a later selection forces a real detail sync.
 */
function metadataSnapshot(raw: RawRepo, ex?: GithubRepository): GithubRepoSnapshot {
  return normalizeRepository(raw, {
    languages: ex?.languages,
    readme:
      ex?.readmeExcerpt && ex.readmeSha
        ? { text: ex.readmeExcerpt, sha: ex.readmeSha }
        : null,
    contributors: ex?.contributors,
    prCount: ex?.prCount,
    commitCount: ex?.commitCount,
    etag: null,
  });
}

async function emitEvidence(
  { store, userId, login, client, ownershipVerified }: SyncParams,
  snapshot: GithubRepoSnapshot,
  stats: GithubSyncStats,
) {
  const record = async (input: MyosEvidenceInput) => {
    const r = await store.upsertEvidenceBySource(userId, input);
    if (r.created) stats.evidenceCreated++;
    else stats.evidenceUpdated++;
  };
  // Directly observed API data is VERIFIED only when ownership of the login was proven by a
  // validated token; a username-only connection proves nothing, so it is merely user-provided.
  // Visibility is PRIVATE always (never public by omission).
  const base = {
    verificationState: (ownershipVerified ? 'VERIFIED' : 'USER_PROVIDED') as
      'VERIFIED' | 'USER_PROVIDED',
    visibility: 'PRIVATE' as const,
  };

  await record({
    ...base,
    sourceType: 'GITHUB_REPO',
    sourceRef: snapshot.fullName,
    sourceUrl: snapshot.htmlUrl,
    title: snapshot.fullName,
    excerpt: cleanText(snapshot.description, 2000),
    occurredAt: snapshot.pushedAt,
    metadata: {
      languages: snapshot.languages,
      topics: snapshot.topics,
      isPrivate: snapshot.isPrivate,
      isFork: snapshot.isFork,
      stars: snapshot.stars,
      // Repository-wide totals (all authors), not the user's own contribution.
      prCount: snapshot.prCount,
      commitCount: snapshot.commitCount,
    },
  });

  if (snapshot.readmeExcerpt) {
    await record({
      ...base,
      sourceType: 'GITHUB_README',
      sourceRef: snapshot.fullName,
      sourceUrl: snapshot.htmlUrl,
      title: `${snapshot.fullName} README`,
      excerpt: cleanText(snapshot.readmeExcerpt, README_EXCERPT_CHARS),
      occurredAt: snapshot.pushedAt,
      metadata: { readmeSha: snapshot.readmeSha, isPrivate: snapshot.isPrivate },
    });
  }

  // Authorship claims ("merged PR by <login>") need proven ownership of the login.
  const prs = ownershipVerified
    ? await client.listMergedPullRequests(snapshot.fullName, login)
    : [];
  for (const pr of prs) {
    const mergedAt = new Date(pr.mergedAt);
    await record({
      ...base,
      sourceType: 'GITHUB_PR',
      sourceRef: `${snapshot.fullName}#${pr.number}`,
      sourceUrl: pr.url,
      title: cleanText(pr.title, 300) || `Pull request #${pr.number}`,
      excerpt: null,
      occurredAt: Number.isNaN(mergedAt.getTime()) ? null : mergedAt.toISOString(),
      metadata: {
        repo: snapshot.fullName,
        number: pr.number,
        isPrivate: snapshot.isPrivate,
      },
    });
  }
}

/**
 * Idempotent, incremental, per-repo-isolated GitHub sync. See docs/myos/GITHUB_INGESTION.md.
 * A selected repo is re-fetched only when it has no successful sync, or its pushed_at changed
 * (and a conditional repo request does not return 304). Repos run with limited concurrency and no
 * new repo is started after the time budget; the run is then PARTIAL and the rest is picked up
 * next run.
 */
export async function syncGithubRepositories(
  params: SyncParams,
): Promise<GithubSyncResult> {
  const { store, client, userId, login } = params;
  const now = params.now ?? (() => new Date());
  const clock = params.clock ?? (() => Date.now());
  const budgetMs = params.maxElapsedMs ?? DEFAULT_SYNC_BUDGET_MS;
  const concurrency = Math.max(1, params.concurrency ?? DEFAULT_SYNC_CONCURRENCY);
  const startedAt = clock();
  const stats: GithubSyncStats = {
    reposListed: 0,
    metadataUpserted: 0,
    detailSynced: 0,
    skippedUnchanged: 0,
    failed: 0,
    evidenceCreated: 0,
    evidenceUpdated: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    ownershipVerified: params.ownershipVerified,
    ownershipNote: params.ownershipVerified ? null : OWNERSHIP_UNVERIFIED_NOTE,
    deferred: 0,
  };
  const run = await store.startSyncRun(userId);
  let status: GithubSyncRunStatus = 'SUCCEEDED';
  let error: string | null = null;

  const finish = async () => {
    await store.finishSyncRun(userId, run.id, {
      status,
      stats: { ...stats, finishedAt: now().toISOString() },
      error,
    });
    return { runId: run.id, status, stats, error };
  };

  const noteRateLimit = (e: RateLimitError) => {
    stats.rateLimited = true;
    stats.rateLimitResetAt = e.resetAt ? e.resetAt.toISOString() : null;
    status = 'PARTIAL';
    error = sanitizeErrorMessage(e);
  };

  try {
    const existing = new Map(
      (await store.listRepositories(userId)).map((r) => [r.githubRepoId, r] as const),
    );
    const raws = await client.listRepositories(login);
    stats.reposListed = raws.length;

    let next = 0;
    let stop = false; // rate limit, auth failure or time budget
    let fatal: unknown = null;

    const processRepo = async (raw: RawRepo) => {
      const ex = existing.get(raw.id);
      try {
        // Rename: re-key evidence from the previous full_name before anything else.
        const renamed = ex !== undefined && ex.fullName !== raw.full_name;
        if (ex && renamed && store.renameRepositoryEvidence) {
          await store.renameRepositoryEvidence(userId, ex.fullName, raw.full_name);
        }
        if (!ex || !ex.selected) {
          // Listing/metadata only. No README/languages/PR calls for unselected repos.
          // ERROR/PENDING rows are always re-upserted so they cannot stay stuck.
          if (!ex || ex.syncStatus !== 'SYNCED' || renamed || listingChanged(ex, raw)) {
            await store.upsertRepositorySnapshot(userId, metadataSnapshot(raw, ex));
            stats.metadataUpserted++;
          } else {
            stats.skippedUnchanged++;
          }
          return;
        }

        // etag is only ever set by a detail fetch, so null means "metadata-only so far".
        // ERROR/PENDING repos are never skipped.
        const lastOk = ex.syncStatus === 'SYNCED' && ex.etag !== null;
        if (lastOk && !renamed && sameInstant(ex.pushedAt, raw.pushed_at ?? null)) {
          stats.skippedUnchanged++;
          return;
        }

        // Only conditional when the last sync succeeded: a 304 has no body to recover from.
        const detail = await client.getRepository(raw.full_name, lastOk ? ex.etag : null);
        if (detail.notModified) {
          stats.skippedUnchanged++;
          return;
        }
        const repoRaw = detail.repo ?? raw;
        const languages = await client.getLanguages(raw.full_name);
        const readme = await client.getReadme(raw.full_name);
        const contributors = await client.getContributors(raw.full_name);
        // Repository-wide totals (all authors), not the user's own merged PRs / commits.
        const prCount = await client.countPullRequests(raw.full_name);
        const commitCount = await client.countCommits(raw.full_name);
        const snapshot = normalizeRepository(
          { ...repoRaw, owner: repoRaw.owner ?? raw.owner },
          { languages, readme, contributors, prCount, commitCount, etag: detail.etag },
        );
        // Evidence first: if PR fetch fails the repo stays retryable (not marked SYNCED).
        await emitEvidence(params, snapshot, stats);
        await store.upsertRepositorySnapshot(userId, snapshot);
        stats.detailSynced++;
      } catch (e) {
        if (e instanceof RateLimitError) {
          noteRateLimit(e);
          stop = true;
          return;
        }
        if (e instanceof AuthError) {
          fatal = e;
          stop = true;
          return;
        }
        stats.failed++;
        status = 'PARTIAL';
        if (ex) {
          try {
            await store.markRepositorySyncError(userId, ex.id, sanitizeErrorMessage(e));
          } catch {
            // best effort; the repo is retried next run either way
          }
        }
      }
    };

    let timedOut = false;
    const worker = async () => {
      while (!stop) {
        if (clock() - startedAt > budgetMs) {
          stop = true;
          timedOut = true;
          return;
        }
        const i = next++;
        if (i >= raws.length) return;
        await processRepo(raws[i]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, raws.length) }, worker));

    if (fatal) throw fatal;
    if (timedOut) {
      stats.deferred = Math.max(0, raws.length - next);
      status = 'PARTIAL';
      error ??= 'Time budget reached; remaining repositories will sync on the next run';
    }
  } catch (e) {
    if (e instanceof RateLimitError) {
      noteRateLimit(e);
    } else {
      status = 'FAILED';
      error = sanitizeErrorMessage(e);
    }
  }
  return await finish();
}
