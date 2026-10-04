import {
  githubConnectionSchema,
  githubRepositorySchema,
  githubSyncRunSchema,
  myosAchievementSchema,
  myosCandidateSchema,
  myosEdgeSchema,
  myosEvidenceSchema,
  myosStorySchema,
  type GithubConnection,
  type GithubRepository,
  type GithubSyncRun,
  type MyosAchievement,
  type MyosCandidate,
  type MyosEdge,
  type MyosEvidence,
  type MyosStory,
} from '@career-os/shared';
import type { Database } from '../types/database.types';

/** Internal row→domain mappers shared by the myos-*.ts query modules (not re-exported). */

type Tables = Database['public']['Tables'];

/**
 * Makes free text safe for Postgres `text`/JSON columns: strips NUL (rejected by Postgres) and
 * drops lone UTF-16 surrogates (rejected when serialised to UTF-8 JSON). Null/undefined pass through.
 */
export function sanitizeDbText(value: string): string;
export function sanitizeDbText(value: string | null): string | null;
export function sanitizeDbText(
  value: string | null | undefined,
): string | null | undefined;
export function sanitizeDbText(
  value: string | null | undefined,
): string | null | undefined {
  if (typeof value !== 'string') return value;
  return value
    .split('\u0000')
    .join('')
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '',
    );
}

/** Higher rank = more trusted. Used so a re-sync never downgrades a verification state. */
export { VERIFICATION_RANK } from '@career-os/shared';

export function rowToEvidence(row: Tables['myos_evidence']['Row']): MyosEvidence {
  return myosEvidenceSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceUrl: row.source_url,
    title: row.title,
    excerpt: row.excerpt,
    occurredAt: row.occurred_at,
    confidence: row.confidence === null ? null : Number(row.confidence),
    verificationState: row.verification_state,
    visibility: row.visibility,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function rowToAchievement(
  row: Tables['myos_achievements']['Row'],
): MyosAchievement {
  return myosAchievementSchema.parse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    occurredOn: row.occurred_on,
    metricText: row.metric_text,
    projectId: row.project_id,
    experienceId: row.experience_id,
    verificationState: row.verification_state,
    userApproved: row.user_approved,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function rowToStory(row: Tables['myos_stories']['Row']): MyosStory {
  return myosStorySchema.parse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    situation: row.situation,
    task: row.task,
    action: row.action,
    result: row.result,
    competencies: row.competencies ?? [],
    themes: row.themes ?? [],
    verificationState: row.verification_state,
    userApproved: row.user_approved,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function rowToEdge(row: Tables['myos_edges']['Row']): MyosEdge {
  return myosEdgeSchema.parse({
    id: row.id,
    userId: row.user_id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    relation: row.relation,
    verificationState: row.verification_state,
    confidence: row.confidence === null ? null : Number(row.confidence),
    note: row.note,
    createdAt: row.created_at,
  });
}

/** The `kind` column is the payload discriminator; the stored payload JSON omits it. */
export function rowToCandidate(row: Tables['myos_candidates']['Row']): MyosCandidate {
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? { ...(row.payload as Record<string, unknown>), kind: row.kind }
      : row.payload;
  return myosCandidateSchema.parse({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    projectId: row.project_id,
    payload,
    evidenceIds: row.evidence_ids ?? [],
    rationale: row.rationale,
    dedupeKey: row.dedupe_key,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  });
}

/** Never reads or maps a credential column — `has_token` is the only token signal. */
export function rowToGithubConnection(
  row: Tables['github_connections']['Row'],
): GithubConnection {
  return githubConnectionSchema.parse({
    userId: row.user_id,
    githubLogin: row.github_login,
    githubUserId: row.github_user_id === null ? null : Number(row.github_user_id),
    hasToken: row.has_token,
    status: row.status,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function rowToGithubRepository(
  row: Tables['github_repositories']['Row'],
): GithubRepository {
  return githubRepositorySchema.parse({
    id: row.id,
    userId: row.user_id,
    githubRepoId: Number(row.github_repo_id),
    fullName: row.full_name,
    description: row.description,
    htmlUrl: row.html_url,
    isPrivate: row.is_private,
    isFork: row.is_fork,
    isArchived: row.is_archived,
    defaultBranch: row.default_branch,
    primaryLanguage: row.primary_language,
    languages: row.languages ?? {},
    topics: row.topics ?? [],
    stars: row.stars,
    repoCreatedAt: row.repo_created_at,
    pushedAt: row.pushed_at,
    readmeExcerpt: row.readme_excerpt,
    readmeSha: row.readme_sha,
    contributors: row.contributors ?? [],
    prCount: row.pr_count,
    commitCount: row.commit_count,
    etag: row.etag,
    selected: row.selected,
    projectId: row.project_id,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function rowToGithubSyncRun(
  row: Tables['github_sync_runs']['Row'],
): GithubSyncRun {
  return githubSyncRunSchema.parse({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    stats: row.stats ?? {},
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}
