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
    .range(offset, offset + limit - 1);
  assertNoError(error, 'listOwnMatchScoresRanked');
  return (data ?? []).map(rowToMatchScore);
}
