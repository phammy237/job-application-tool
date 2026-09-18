import {
  jobSourceSchema,
  type JobSource,
  type JobSourceImportEntry,
  type JobSourceType,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['job_sources']['Row'];

// Bounded, sanitized last_error column cap (matches the migration's CHECK constraint) — applied
// here too so a caller building the string never has to know the database limit independently.
const LAST_ERROR_MAX_LENGTH = 2000;

function rowToJobSource(row: Row): JobSource {
  return jobSourceSchema.parse({
    id: row.id,
    companyName: row.company_name,
    sourceType: row.source_type,
    sourceIdentifier: row.source_identifier,
    careersUrl: row.careers_url,
    enabled: row.enabled,
    crawlIntervalHours: row.crawl_interval_hours,
    lastCrawledAt: row.last_crawled_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    etag: row.etag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function getJobSource(
  supabase: CareerOsSupabaseClient,
  id: string,
): Promise<JobSource | null> {
  const { data, error } = await supabase.from('job_sources').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getJobSource');
  return data ? rowToJobSource(data) : null;
}

/**
 * `job_sources` is small (hundreds of rows, per docs/JOB_DISCOVERY.md's scale target) —
 * "due for crawl" is computed by fetching every enabled source (optionally narrowed by id/
 * provider) and filtering in application code, rather than trying to express a per-row interval
 * comparison in a single PostgREST filter (each row's own `crawl_interval_hours` differs, which
 * a flat `.lte(...)` can't express).
 */
export async function listEnabledJobSourcesDueForCrawl(
  supabase: CareerOsSupabaseClient,
  options: { sourceId?: string; provider?: JobSourceType; now?: Date } = {},
): Promise<JobSource[]> {
  let query = supabase.from('job_sources').select('*').eq('enabled', true);
  if (options.sourceId) query = query.eq('id', options.sourceId);
  if (options.provider) query = query.eq('source_type', options.provider);

  const { data, error } = await query;
  assertNoError(error, 'listEnabledJobSourcesDueForCrawl');

  const now = options.now ?? new Date();
  return (data ?? [])
    .map(rowToJobSource)
    .filter((source) => {
      if (!source.lastCrawledAt) return true;
      const dueAt = new Date(source.lastCrawledAt).getTime() + source.crawlIntervalHours * 3_600_000;
      return dueAt <= now.getTime();
    });
}

export async function listAllJobSources(supabase: CareerOsSupabaseClient): Promise<JobSource[]> {
  const { data, error } = await supabase.from('job_sources').select('*').order('company_name');
  assertNoError(error, 'listAllJobSources');
  return (data ?? []).map(rowToJobSource);
}

/**
 * Idempotent upsert keyed on the real uniqueness constraint, `(source_type, source_identifier)`
 * — used exclusively by `scripts/discovery/import-sources.ts`. Only the fields actually present
 * on `entry` are written: an omitted optional field (`enabled`, `crawlIntervalHours`,
 * `careersUrl`) is left untouched on an existing row rather than silently reset to a default,
 * so re-running the import file never clobbers operational tuning (e.g. an operator disabling a
 * noisy source) that isn't itself expressed in the source file.
 */
export async function upsertJobSource(
  supabase: CareerOsSupabaseClient,
  entry: JobSourceImportEntry,
): Promise<JobSource> {
  const payload: Database['public']['Tables']['job_sources']['Insert'] = {
    company_name: entry.companyName,
    source_type: entry.sourceType,
    source_identifier: entry.sourceIdentifier,
  };
  if (entry.careersUrl !== undefined) payload.careers_url = entry.careersUrl;
  if (entry.enabled !== undefined) payload.enabled = entry.enabled;
  if (entry.crawlIntervalHours !== undefined) payload.crawl_interval_hours = entry.crawlIntervalHours;

  const { data, error } = await supabase
    .from('job_sources')
    .upsert(payload, { onConflict: 'source_type,source_identifier' })
    .select('*')
    .single();
  return rowToJobSource(unwrapRow(data, error, 'upsertJobSource'));
}

export async function recordJobSourceCrawlSuccess(
  supabase: CareerOsSupabaseClient,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from('job_sources')
    .update({
      last_crawled_at: nowIso,
      last_success_at: nowIso,
      consecutive_failures: 0,
      last_error: null,
    })
    .eq('id', id);
  assertNoError(error, 'recordJobSourceCrawlSuccess');
}

/**
 * D7 — caches the GitHub Contents API's ETag for this source so the next sync can send
 * `If-None-Match` and skip re-parsing an unchanged README on a 304. `etag: null` explicitly clears
 * a stale value (e.g. after a non-304 response) rather than leaving a caller to guess whether
 * omitting the field means "don't touch it."
 */
export async function updateJobSourceEtag(
  supabase: CareerOsSupabaseClient,
  id: string,
  etag: string | null,
): Promise<void> {
  const { error } = await supabase.from('job_sources').update({ etag }).eq('id', id);
  assertNoError(error, 'updateJobSourceEtag');
}

/**
 * `errorMessage` is truncated to the same bound the database CHECK constraint enforces — belt
 * and suspenders, so a caller that forgot to sanitize/bound its own error string still can't fail
 * the write, and never stores a giant provider response body or a secret-bearing stack trace
 * (docs/JOB_DISCOVERY.md "Source health").
 */
export async function recordJobSourceCrawlFailure(
  supabase: CareerOsSupabaseClient,
  id: string,
  errorMessage: string,
  now: Date = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const bounded = errorMessage.slice(0, LAST_ERROR_MAX_LENGTH);

  const current = await getJobSource(supabase, id);
  const nextFailures = (current?.consecutiveFailures ?? 0) + 1;

  const { error } = await supabase
    .from('job_sources')
    .update({
      last_crawled_at: nowIso,
      last_error_at: nowIso,
      last_error: bounded,
      consecutive_failures: nextFailures,
    })
    .eq('id', id);
  assertNoError(error, 'recordJobSourceCrawlFailure');
}
