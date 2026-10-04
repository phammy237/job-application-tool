import { userJobMatchScoreSchema, type UserJobMatchScore } from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['user_job_match_scores']['Row'];
type InsertRow = Database['public']['Tables']['user_job_match_scores']['Insert'];

const UPSERT_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function rowToMatchScore(row: Row): UserJobMatchScore {
  return userJobMatchScoreSchema.parse({
    id: row.id,
    userId: row.user_id,
    jobCatalogId: row.job_catalog_id,
    matchScore: row.match_score,
    coverage: row.coverage,
    eligibilityStatus: row.eligibility_status,
    scoreComponents: row.score_components,
    eligibilityChecks: row.eligibility_checks,
    rankingVersion: row.ranking_version,
    featureVersion: row.feature_version,
    eligibilityVersion: row.eligibility_version,
    computedAt: row.computed_at,
    createdAt: row.created_at,
  });
}

export interface MatchScoreUpsertEntry {
  jobCatalogId: string;
  matchScore: number;
  coverage: number;
  eligibilityStatus: 'ELIGIBLE' | 'UNKNOWN' | 'CONFLICT';
  scoreComponents: unknown;
  eligibilityChecks: unknown;
  rankingVersion: string;
  featureVersion: string;
  eligibilityVersion: string;
}

/** Batched upsert keyed on the table's real unique constraint, `(user_id, job_catalog_id)` — V1
 * keeps exactly one current score per (user, job) pair; recomputation overwrites in place rather
 * than accumulating history (docs/JOB_DISCOVERY.md "Persistence"). */
export async function upsertUserJobMatchScoresBatch(
  supabase: CareerOsSupabaseClient,
  userId: string,
  entries: ReadonlyArray<MatchScoreUpsertEntry>,
  now: Date = new Date(),
): Promise<void> {
  if (entries.length === 0) return;
  const nowIso = now.toISOString();

  const rows: InsertRow[] = entries.map((entry) => ({
    user_id: userId,
    job_catalog_id: entry.jobCatalogId,
    match_score: entry.matchScore,
    coverage: entry.coverage,
    eligibility_status: entry.eligibilityStatus,
    score_components: entry.scoreComponents as Json,
    eligibility_checks: entry.eligibilityChecks as Json,
    ranking_version: entry.rankingVersion,
    feature_version: entry.featureVersion,
    eligibility_version: entry.eligibilityVersion,
    computed_at: nowIso,
  }));

  for (const rowsChunk of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('user_job_match_scores')
      .upsert(rowsChunk, { onConflict: 'user_id,job_catalog_id' });
    assertNoError(error, 'upsertUserJobMatchScoresBatch');
  }
}

export async function getOwnMatchScore(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobCatalogId: string,
): Promise<UserJobMatchScore | null> {
  const { data, error } = await supabase
    .from('user_job_match_scores')
    .select('*')
    .eq('user_id', userId)
    .eq('job_catalog_id', jobCatalogId)
    .maybeSingle();
  assertNoError(error, 'getOwnMatchScore');
  return data ? rowToMatchScore(data) : null;
}

/** Batched lookup for a known set of `job_catalog_id`s — used by the Auto Mode review queue
 * (/dashboard's "Needs your review" section) to render each queued application's current Match/
 * Coverage/Eligibility in one query rather than one `getOwnMatchScore` call per card. Returns a
 * map keyed by `jobCatalogId`; a candidate with no entry simply has no score to show (the job was
 * never scored, or scoring was later removed) — never treated as an error. */
export async function listOwnMatchScoresForJobCatalogIds(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobCatalogIds: string[],
): Promise<Map<string, UserJobMatchScore>> {
  if (jobCatalogIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('user_job_match_scores')
    .select('*')
    .eq('user_id', userId)
    .in('job_catalog_id', jobCatalogIds);
  assertNoError(error, 'listOwnMatchScoresForJobCatalogIds');
  return new Map((data ?? []).map((row) => [row.job_catalog_id, rowToMatchScore(row)]));
}

/**
 * Candidate jobs for the Auto Mode cron job (D9 Phase A, `runAutoQueueForUser`) — this user's own
 * high-Match, high-Coverage (`coverage_bucket = 0`, i.e. HIGH — the same generated column/tiering
 * `packages/shared/src/lib/default-discovery-order.ts`'s `getCoverageBucket` mirrors, migration
 * 0031), non-CONFLICT scores, highest `match_score` first. Deliberately a direct filtered query
 * over this table rather than the `list_own_discovery_feed` RPC: that RPC is `security invoker`
 * and reads `auth.uid()`, which is null under the service-role admin client this orchestrator
 * runs on — composing the identical filter here, with an explicit `user_id` eq, is the correct
 * replacement, not a new RPC. Reuses the existing D4/D5A scoring outputs verbatim; introduces no
 * new scoring system.
 */
export async function listOwnAutoQueueCandidateMatchScores(
  supabase: CareerOsSupabaseClient,
  userId: string,
  options: { minMatchScore: number; limit: number },
): Promise<UserJobMatchScore[]> {
  const { data, error } = await supabase
    .from('user_job_match_scores')
    .select('*')
    .eq('user_id', userId)
    .eq('coverage_bucket', 0)
    .neq('eligibility_status', 'CONFLICT')
    .gte('match_score', options.minMatchScore)
    .order('match_score', { ascending: false })
    .order('job_catalog_id', { ascending: true })
    .limit(options.limit);
  assertNoError(error, 'listOwnAutoQueueCandidateMatchScores');
  return (data ?? []).map(rowToMatchScore);
}

/** Ranked (highest match first) page of the caller's own scores — the shape a future D5
 * `/discover` list will page through. */
export async function listOwnMatchScoresRanked(
  supabase: CareerOsSupabaseClient,
  userId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<UserJobMatchScore[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const { data, error } = await supabase
    .from('user_job_match_scores')
    .select('*')
    .eq('user_id', userId)
    .order('match_score', { ascending: false })
    // Tiebreaker on a stable, unique column — `match_score` is a bounded/rounded number, so ties
    // are plausible, and `.range()` paging needs a fully deterministic order to avoid skipping or
    // duplicating a tied row across page boundaries.
    .order('job_catalog_id', { ascending: true })
    .range(offset, offset + limit - 1);
  assertNoError(error, 'listOwnMatchScoresRanked');
  return (data ?? []).map(rowToMatchScore);
}
