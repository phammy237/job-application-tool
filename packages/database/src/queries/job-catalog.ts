import {
  jobCatalogEntrySchema,
  type JobCatalogEntry,
  type NormalizedDiscoveredJob,
} from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['job_catalog']['Row'];
type InsertRow = Database['public']['Tables']['job_catalog']['Insert'];

// PostgREST filter/body sizes stay well within limits at these chunk sizes even for
// full-content rows (description can be up to ~20k chars) — see docs/JOB_DISCOVERY.md "Database
// write boundary" for the batching rationale (avoid N+1 without prematurely over-architecting
// for the "hundreds of sources / tens of thousands of jobs" scale target).
const EXISTING_LOOKUP_CHUNK_SIZE = 200;
const CONTENT_UPSERT_CHUNK_SIZE = 50;
const FRESHNESS_UPDATE_CHUNK_SIZE = 300;

function rowToJobCatalogEntry(row: Row): JobCatalogEntry {
  return jobCatalogEntrySchema.parse({
    id: row.id,
    sourceId: row.source_id,
    sourceJobId: row.source_job_id,
    companyName: row.company_name,
    title: row.title,
    normalizedTitle: row.normalized_title,
    locationText: row.location_text,
    normalizedLocation: row.normalized_location,
    city: row.city,
    stateRegion: row.state_region,
    country: row.country,
    workplaceType: row.workplace_type,
    employmentType: row.employment_type,
    description: row.description,
    responsibilities: row.responsibilities,
    qualifications: row.qualifications,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    applyUrl: row.apply_url,
    sourceUrl: row.source_url,
    canonicalApplyUrl: row.canonical_apply_url,
    dedupeFingerprint: row.dedupe_fingerprint,
    postedAt: row.posted_at,
    sourceUpdatedAt: row.source_updated_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    contentUpdatedAt: row.content_updated_at,
    consecutiveMisses: row.consecutive_misses,
    status: row.status,
    closedAt: row.closed_at,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function getJobCatalogEntry(
  supabase: CareerOsSupabaseClient,
  sourceId: string,
  sourceJobId: string,
): Promise<JobCatalogEntry | null> {
  const { data, error } = await supabase
    .from('job_catalog')
    .select('*')
    .eq('source_id', sourceId)
    .eq('source_job_id', sourceJobId)
    .maybeSingle();
  assertNoError(error, 'getJobCatalogEntry');
  return data ? rowToJobCatalogEntry(data) : null;
}

/** Lookup by the table's own primary key — added for D5A's `/discover/[id]` detail page, which
 * only ever has the `job_catalog.id` (from the feed RPC), never the `(source_id, source_job_id)`
 * pair `getJobCatalogEntry` above was built for. Purely additive; that function's own behavior
 * and every existing call site are unchanged. */
export async function getJobCatalogEntryById(
  supabase: CareerOsSupabaseClient,
  id: string,
): Promise<JobCatalogEntry | null> {
  const { data, error } = await supabase
    .from('job_catalog')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(error, 'getJobCatalogEntryById');
  return data ? rowToJobCatalogEntry(data) : null;
}

function normalizedJobToRow(
  sourceId: string,
  job: NormalizedDiscoveredJob,
  firstSeenAtIso: string,
  nowIso: string,
): InsertRow {
  return {
    source_id: sourceId,
    source_job_id: job.sourceJobId,
    company_name: job.companyName,
    title: job.title,
    normalized_title: job.normalizedTitle,
    location_text: job.locationText,
    normalized_location: job.normalizedLocation,
    city: job.city,
    state_region: job.stateRegion,
    country: job.country,
    workplace_type: job.workplaceType,
    employment_type: job.employmentType,
    description: job.description,
    responsibilities: job.responsibilities,
    qualifications: job.qualifications,
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    apply_url: job.applyUrl,
    source_url: job.sourceUrl,
    canonical_apply_url: job.canonicalApplyUrl,
    dedupe_fingerprint: job.dedupeFingerprint,
    posted_at: job.postedAt,
    source_updated_at: job.sourceUpdatedAt,
    content_hash: job.contentHash,
    first_seen_at: firstSeenAtIso,
    last_seen_at: nowIso,
    content_updated_at: nowIso,
    consecutive_misses: 0,
    status: 'ACTIVE',
    closed_at: null,
  };
}

export interface UpsertDiscoveredJobsSummary {
  new: number;
  updated: number;
  unchanged: number;
  reopened: number;
}

/**
 * Upsert semantics exactly as specified in docs/JOB_DISCOVERY.md "Upsert semantics" — new job
 * (ACTIVE, first_seen == last_seen, misses 0), existing+same hash (only freshness fields touched,
 * first_seen_at/content_updated_at untouched), existing+changed hash (content rewritten,
 * content_updated_at advances, first_seen_at preserved), previously-closed reappears (reopened to
 * ACTIVE, no duplicate row). No custom Postgres RPC — two batched PostgREST round trips (a
 * pre-fetch of existing rows, then differentiated writes) comfortably cover the "hundreds of
 * sources / tens of thousands of jobs" scale target without the added risk of a hand-written
 * upsert-with-classification SQL function; see docs/JOB_DISCOVERY.md "Database query layer" for
 * why this was the deliberate choice over a gratuitous service-role RPC.
 *
 * `jobs` MUST already be deduped by `sourceJobId` by the caller (docs/JOB_DISCOVERY.md
 * "Deduplication behavior", scenario H) — a duplicate id reaching Postgres's `ON CONFLICT` target
 * twice in one statement is a hard database error, not a soft one, so this function defensively
 * keeps only the first occurrence of any repeated `sourceJobId` as a last-resort safety net, but
 * the orchestrator is expected to have already counted/rejected the rest.
 */
export async function upsertDiscoveredJobsForSource(
  supabase: CareerOsSupabaseClient,
  sourceId: string,
  jobs: NormalizedDiscoveredJob[],
  now: Date = new Date(),
): Promise<UpsertDiscoveredJobsSummary> {
  const summary: UpsertDiscoveredJobsSummary = { new: 0, updated: 0, unchanged: 0, reopened: 0 };
  if (jobs.length === 0) return summary;

  const deduped = new Map<string, NormalizedDiscoveredJob>();
  for (const job of jobs) {
    if (!deduped.has(job.sourceJobId)) deduped.set(job.sourceJobId, job);
  }
  const uniqueJobs = [...deduped.values()];

  const nowIso = now.toISOString();

  // Step 1: fetch existing rows for this batch's ids, chunked.
  const existingById = new Map<
    string,
    { id: string; contentHash: string; status: string; firstSeenAt: string }
  >();
  for (const idsChunk of chunk(
    uniqueJobs.map((j) => j.sourceJobId),
    EXISTING_LOOKUP_CHUNK_SIZE,
  )) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select('id, source_job_id, content_hash, status, first_seen_at')
      .eq('source_id', sourceId)
      .in('source_job_id', idsChunk);
    assertNoError(error, 'upsertDiscoveredJobsForSource (existing lookup)');
    for (const row of data ?? []) {
      existingById.set(row.source_job_id, {
        id: row.id,
        contentHash: row.content_hash,
        status: row.status,
        firstSeenAt: row.first_seen_at,
      });
    }
  }

  // Step 2: classify. "Content" writes (new rows + rows whose content_hash changed) carry the
  // full row payload; "freshness-only" writes (unchanged content, including a reopen with
  // unchanged content) touch only last_seen_at/misses/status/closed_at, leaving
  // first_seen_at/content_updated_at/every content column untouched by construction.
  const contentRows: InsertRow[] = [];
  const freshnessOnlyIds: string[] = [];

  for (const job of uniqueJobs) {
    const existing = existingById.get(job.sourceJobId);
    if (!existing) {
      contentRows.push(normalizedJobToRow(sourceId, job, nowIso, nowIso));
      summary.new += 1;
      continue;
    }

    const wasClosed = existing.status === 'CLOSED';
    if (existing.contentHash === job.contentHash) {
      freshnessOnlyIds.push(existing.id);
      if (wasClosed) summary.reopened += 1;
      else summary.unchanged += 1;
    } else {
      contentRows.push(normalizedJobToRow(sourceId, job, existing.firstSeenAt, nowIso));
      if (wasClosed) summary.reopened += 1;
      else summary.updated += 1;
    }
  }

  // Step 3a: batched upsert for new + content-changed rows.
  for (const rowsChunk of chunk(contentRows, CONTENT_UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('job_catalog')
      .upsert(rowsChunk, { onConflict: 'source_id,source_job_id' });
    assertNoError(error, 'upsertDiscoveredJobsForSource (content upsert)');
  }

  // Step 3b: batched freshness-only update for unchanged/reopened-unchanged rows.
  for (const idsChunk of chunk(freshnessOnlyIds, FRESHNESS_UPDATE_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('job_catalog')
      .update({
        last_seen_at: nowIso,
        consecutive_misses: 0,
        status: 'ACTIVE',
        closed_at: null,
      })
      .in('id', idsChunk);
    assertNoError(error, 'upsertDiscoveredJobsForSource (freshness update)');
  }

  return summary;
}

export interface ReconcileMissingJobsSummary {
  possiblyClosed: number;
  closed: number;
}

/**
 * Freshness/closed-job lifecycle (docs/JOB_DISCOVERY.md "Closed-job lifecycle") — MUST only be
 * called after a source's crawl completed successfully in full (never on a failed/partial/
 * timed-out fetch; see docs/JOB_DISCOVERY.md "Failure isolation" and the orchestrator, which is
 * the sole caller and enforces this). Only ACTIVE/POSSIBLY_CLOSED rows for this source are
 * considered; CLOSED rows are left alone (a closed job reappearing is handled entirely by
 * `upsertDiscoveredJobsForSource`'s own reopen path, not here).
 */
export async function reconcileMissingJobsForSource(
  supabase: CareerOsSupabaseClient,
  sourceId: string,
  seenSourceJobIds: string[],
  now: Date = new Date(),
): Promise<ReconcileMissingJobsSummary> {
  const summary: ReconcileMissingJobsSummary = { possiblyClosed: 0, closed: 0 };
  const nowIso = now.toISOString();
  const seen = new Set(seenSourceJobIds);

  const { data, error } = await supabase
    .from('job_catalog')
    .select('id, source_job_id, consecutive_misses, status')
    .eq('source_id', sourceId)
    .in('status', ['ACTIVE', 'POSSIBLY_CLOSED']);
  assertNoError(error, 'reconcileMissingJobsForSource (active lookup)');

  const missing = (data ?? []).filter((row) => !seen.has(row.source_job_id));
  if (missing.length === 0) return summary;

  // Every row's *new* miss count is old + 1; whether that lands it in POSSIBLY_CLOSED or CLOSED
  // depends only on the resulting value (>= 2 => CLOSED), never on which crawl produced it.
  // Grouped by the resulting new-miss value (bounded — in the expected invariant this is always
  // exactly {1, 2}, but grouped defensively rather than assumed) so this is always a small,
  // fixed number of batched UPDATEs, never one write per missing job.
  const byNewMisses = new Map<number, string[]>();
  for (const row of missing) {
    const newMisses = row.consecutive_misses + 1;
    const ids = byNewMisses.get(newMisses) ?? [];
    ids.push(row.id);
    byNewMisses.set(newMisses, ids);
  }

  for (const [newMisses, ids] of byNewMisses) {
    const willClose = newMisses >= 2;
    for (const idsChunk of chunk(ids, FRESHNESS_UPDATE_CHUNK_SIZE)) {
      const { error: updateError } = await supabase
        .from('job_catalog')
        .update({
          consecutive_misses: newMisses,
          status: willClose ? 'CLOSED' : 'POSSIBLY_CLOSED',
          closed_at: willClose ? nowIso : null,
        })
        .in('id', idsChunk);
      assertNoError(updateError, 'reconcileMissingJobsForSource (status update)');
    }
    if (willClose) summary.closed += ids.length;
    else summary.possiblyClosed += ids.length;
  }

  return summary;
}
