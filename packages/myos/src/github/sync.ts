import type {
  GithubRepository,
  GithubRepoSnapshot,
  MyosEvidenceInput,
} from '@career-os/shared';
import type { GithubClient, RawRepo } from './client';
import { AuthError, RateLimitError, sanitizeErrorMessage } from './errors';
import { normalizeRepository } from './normalize';

export type GithubSyncRunStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

/**
 * Persistence seam. apps/web/lib/myos-github-store.ts implements this with thin adapters over
 * packages/database/src/queries/myos-github.ts / myos-evidence.ts (supabase client + userId bound):
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
}

const README_EXCERPT_CHARS = 2000;

/** DB timestamps may come back as `+00:00`; compare instants, not strings. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function listingChanged(ex: GithubRepository, raw: RawRepo): boolean {
  return (
    !sameInstant(ex.pushedAt, raw.pushed_at ?? null) ||
    ex.description !== (raw.description ?? null) ||
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
  { store, userId, login, client }: SyncParams,
  snapshot: GithubRepoSnapshot,
  stats: GithubSyncStats,
) {
  const record = async (input: MyosEvidenceInput) => {
    const r = await store.upsertEvidenceBySource(userId, input);
    if (r.created) stats.evidenceCreated++;
    else stats.evidenceUpdated++;
  };
  // Directly observed API data => VERIFIED. Visibility is PRIVATE always (never public by
  // omission; private repos must never leave PRIVATE).
  const base = { verificationState: 'VERIFIED' as const, visibility: 'PRIVATE' as const };

  await record({
    ...base,
    sourceType: 'GITHUB_REPO',
    sourceRef: snapshot.fullName,
    sourceUrl: snapshot.htmlUrl,
    title: snapshot.fullName,
    excerpt: snapshot.description ? snapshot.description.slice(0, 2000) : null,
    occurredAt: snapshot.pushedAt,
    metadata: {
      languages: snapshot.languages,
      topics: snapshot.topics,
      isPrivate: snapshot.isPrivate,
      isFork: snapshot.isFork,
      stars: snapshot.stars,
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
      excerpt: snapshot.readmeExcerpt.slice(0, README_EXCERPT_CHARS),
      occurredAt: snapshot.pushedAt,
      metadata: { readmeSha: snapshot.readmeSha, isPrivate: snapshot.isPrivate },
    });
  }

  const prs = await client.listMergedPullRequests(snapshot.fullName, login);
  for (const pr of prs) {
    const mergedAt = new Date(pr.mergedAt);
    await record({
      ...base,
      sourceType: 'GITHUB_PR',
      sourceRef: `${snapshot.fullName}#${pr.number}`,
      sourceUrl: pr.url,
      title: pr.title.slice(0, 300),
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
 * (and a conditional repo request does not return 304).
 */
export async function syncGithubRepositories(
  params: SyncParams,
): Promise<GithubSyncResult> {
  const { store, client, userId, login } = params;
  const now = params.now ?? (() => new Date());
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

    for (const raw of raws) {
      const ex = existing.get(raw.id);
      try {
        if (!ex || !ex.selected) {
          // Listing/metadata only. No README/languages/PR calls for unselected repos.
          if (!ex || listingChanged(ex, raw)) {
            await store.upsertRepositorySnapshot(userId, metadataSnapshot(raw, ex));
            stats.metadataUpserted++;
          } else {
            stats.skippedUnchanged++;
          }
          continue;
        }

        // etag is only ever set by a detail fetch, so null means "metadata-only so far".
        const lastOk = ex.syncStatus === 'SYNCED' && ex.etag !== null;
        if (lastOk && sameInstant(ex.pushedAt, raw.pushed_at ?? null)) {
          stats.skippedUnchanged++;
          continue;
        }

        // Only conditional when the last sync succeeded: a 304 has no body to recover from.
        const detail = await client.getRepository(raw.full_name, lastOk ? ex.etag : null);
        if (detail.notModified) {
          stats.skippedUnchanged++;
          continue;
        }
        const repoRaw = detail.repo ?? raw;
        const [languages, readme, contributors, prCount, commitCount] = [
          await client.getLanguages(raw.full_name),
          await client.getReadme(raw.full_name),
          await client.getContributors(raw.full_name),
          await client.countPullRequests(raw.full_name),
          await client.countCommits(raw.full_name),
        ];
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
          return await finish();
        }
        if (e instanceof AuthError) throw e;
        stats.failed++;
        status = 'PARTIAL';
        if (ex)
          await store.markRepositorySyncError(userId, ex.id, sanitizeErrorMessage(e));
      }
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
