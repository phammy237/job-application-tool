import {
  classifyJobPostingHost,
  jobCatalogEntrySchema,
  type CrossSourceObservation,
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
    crossSourceObservations: Array.isArray(row.cross_source_observations)
      ? row.cross_source_observations
      : [],
    postedAt: row.posted_at,
    sourceUpdatedAt: row.source_updated_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    contentUpdatedAt: row.content_updated_at,
    consecutiveMisses: row.consecutive_misses,
    status: row.status,
    closedAt: row.closed_at,
    resolutionStatus: row.resolution_status,
    resolutionStrategy: row.resolution_strategy,
    resolutionConfidence: row.resolution_confidence,
    resolutionCandidateUrl: row.resolution_candidate_url,
    resolutionAttemptCount: row.resolution_attempt_count,
    resolutionLastAttemptAt: row.resolution_last_attempt_at,
    resolutionLinkCheckFailures: row.resolution_link_check_failures,
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
    {
      id: string;
      contentHash: string;
      status: string;
      firstSeenAt: string;
      canonicalApplyUrl: string | null;
    }
  >();
  for (const idsChunk of chunk(
    uniqueJobs.map((j) => j.sourceJobId),
    EXISTING_LOOKUP_CHUNK_SIZE,
  )) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select('id, source_job_id, content_hash, status, first_seen_at, canonical_apply_url')
      .eq('source_id', sourceId)
      .in('source_job_id', idsChunk);
    assertNoError(error, 'upsertDiscoveredJobsForSource (existing lookup)');
    for (const row of data ?? []) {
      existingById.set(row.source_job_id, {
        id: row.id,
        contentHash: row.content_hash,
        status: row.status,
        firstSeenAt: row.first_seen_at,
        canonicalApplyUrl: row.canonical_apply_url,
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

    // D7.1 — a MERGED row (this job's real-world posting is now tracked canonically under a
    // different, ATS-native job_catalog row) must never be reopened by its own source's normal
    // resync: unlike CLOSED, nothing about a MERGED row's absence/presence in the source feed is
    // meaningful anymore, so it is skipped entirely here — no freshness touch, no content
    // overwrite, not counted in this summary (docs/JOB_DISCOVERY.md "Official posting resolution").
    if (existing.status === 'MERGED') continue;

    const wasClosed = existing.status === 'CLOSED';
    const staleAggregatorUrl = existing.canonicalApplyUrl != null &&
      classifyJobPostingHost(existing.canonicalApplyUrl) === 'REJECTED_AGGREGATOR';
    if (existing.contentHash === job.contentHash && !staleAggregatorUrl) {
      freshnessOnlyIds.push(existing.id);
      if (wasClosed) summary.reopened += 1;
      else summary.unchanged += 1;
    } else {
      const row = normalizedJobToRow(sourceId, job, existing.firstSeenAt, nowIso);
      // Bug fix (post-D7.1) — a resolved `canonical_apply_url` (set by
      // official-posting-resolution.ts, never by this ingestion path) must never be regressed to
      // null by a routine content resync just because this sync's freshly-normalized value came
      // back null (e.g. a Jobright row whose own applyUrl always normalizes to null now that
      // normalize.ts rejects aggregator hosts). Only ever falls back to the existing value when
      // the new one is null — a genuinely new non-null value (an ATS adapter's own applyUrl
      // changing) always wins, so ATS-native freshness is untouched.
      row.canonical_apply_url = job.canonicalApplyUrl ??
        (staleAggregatorUrl ? null : existing.canonicalApplyUrl);
      contentRows.push(row);
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

export interface JobCatalogDedupeCandidateRow {
  jobCatalogId: string;
  sourceId: string;
  companyName: string;
  title: string;
  locationText: string | null;
  canonicalApplyUrl: string | null;
  postedAt: string | null;
}

/**
 * D7 §8 — the full candidate set for cross-source dedupe: every ACTIVE catalog row belonging to
 * one of the given (non-Jobright) `sourceIds`, in the shape `cross-source-dedupe.ts`'s pure
 * matching functions need. Fetched once per sync run by the orchestrator, never once per
 * candidate row — see that module's own doc comment for why this stays a single query.
 */
export async function listActiveJobCatalogEntriesForDedupe(
  supabase: CareerOsSupabaseClient,
  sourceIds: string[],
): Promise<JobCatalogDedupeCandidateRow[]> {
  if (sourceIds.length === 0) return [];
  const result: JobCatalogDedupeCandidateRow[] = [];
  for (const idsChunk of chunk(sourceIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select('id, source_id, company_name, title, location_text, canonical_apply_url, posted_at')
      .eq('status', 'ACTIVE')
      .in('source_id', idsChunk);
    assertNoError(error, 'listActiveJobCatalogEntriesForDedupe');
    for (const row of data ?? []) {
      result.push({
        jobCatalogId: row.id,
        sourceId: row.source_id,
        companyName: row.company_name,
        title: row.title,
        locationText: row.location_text,
        canonicalApplyUrl: row.canonical_apply_url,
        postedAt: row.posted_at,
      });
    }
  }
  return result;
}

/**
 * D7 §8 — records a suppressed duplicate observation on the canonical row without touching its
 * own identity (`source_id`/`source_job_id`) or any ranking-relevant field. Reads the current
 * array first rather than a database-side JSONB append so a duplicate observation (the same
 * `provider`+`sourceJobId` seen again on a later sync) is never appended twice.
 */
export async function appendCrossSourceObservation(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
  observation: CrossSourceObservation,
): Promise<void> {
  const { data, error } = await supabase
    .from('job_catalog')
    .select('cross_source_observations')
    .eq('id', jobCatalogId)
    .maybeSingle();
  assertNoError(error, 'appendCrossSourceObservation (read)');
  const existing: CrossSourceObservation[] = Array.isArray(data?.cross_source_observations)
    ? (data.cross_source_observations as CrossSourceObservation[])
    : [];

  const alreadyPresent = existing.some(
    (o) => o.provider === observation.provider && o.sourceJobId === observation.sourceJobId,
  );
  const next = alreadyPresent
    ? existing.map((o) =>
        o.provider === observation.provider && o.sourceJobId === observation.sourceJobId
          ? observation
          : o,
      )
    : [...existing, observation];

  const { error: updateError } = await supabase
    .from('job_catalog')
    .update({ cross_source_observations: next })
    .eq('id', jobCatalogId);
  assertNoError(updateError, 'appendCrossSourceObservation (write)');
}

/**
 * D7.1 — deletes every `user_job_match_scores` row for one `job_catalog` row (across all users).
 * Used only when a job_catalog row is merged into an ATS-native duplicate: the feed RPC
 * (`list_own_discovery_feed`) has no `job_catalog.status` filter at all, so a stale match score
 * would otherwise keep a MERGED row's card visible forever, regardless of its status. Never
 * touches the `job_catalog` row itself or any other user's data beyond their own score on this one
 * job — the same "delete, don't disable" precedent this table already uses for a superseded score.
 */
export async function deleteMatchScoresForJobCatalogId(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_job_match_scores')
    .delete()
    .eq('job_catalog_id', jobCatalogId);
  assertNoError(error, 'deleteMatchScoresForJobCatalogId');
}

/**
 * D7.1 — the one write for "this Jobright job_catalog row's real-world posting is now tracked
 * canonically under `atsJobCatalogId`": appends the cross-source observation onto the ATS row
 * (reusing the existing D7 `appendCrossSourceObservation`, unchanged), deletes the Jobright row's
 * own match scores (see above), and marks the Jobright row `MERGED` with
 * `resolution_status = RESOLVED_HIGH_CONFIDENCE` / `resolution_strategy = CATALOG_MATCH`. Never
 * deletes the Jobright row itself or its content — provenance is retained, only its independent
 * visibility/ranking stops.
 */
export async function mergeJobCatalogRowIntoAtsMatch(
  supabase: CareerOsSupabaseClient,
  params: {
    jobrightJobCatalogId: string;
    atsJobCatalogId: string;
    observation: CrossSourceObservation;
  },
  now: Date = new Date(),
): Promise<void> {
  await appendCrossSourceObservation(supabase, params.atsJobCatalogId, params.observation);
  await deleteMatchScoresForJobCatalogId(supabase, params.jobrightJobCatalogId);

  const { error } = await supabase
    .from('job_catalog')
    .update({
      status: 'MERGED',
      resolution_status: 'RESOLVED_HIGH_CONFIDENCE',
      resolution_strategy: 'CATALOG_MATCH',
      resolution_confidence: 100,
      resolution_attempt_count: 1,
      resolution_last_attempt_at: now.toISOString(),
    })
    .eq('id', params.jobrightJobCatalogId);
  assertNoError(error, 'mergeJobCatalogRowIntoAtsMatch');
}

export interface OfficialPostingResolutionCandidate {
  jobCatalogId: string;
  sourceId: string;
  sourceJobId: string;
  companyName: string;
  title: string;
  locationText: string | null;
  canonicalApplyUrl: string | null;
  sourceUrl: string | null;
  applyUrl: string;
  postedAt: string | null;
  resolutionAttemptCount: number;
}

/**
 * D7.1 §10 — the bounded set of ACTIVE Jobright-sourced rows still eligible for an official-posting
 * resolution attempt: never-attempted rows, plus previously UNRESOLVED/RESOLVED_REVIEW rows whose
 * last attempt is older than `retryAfterMs` (search-cost control — never re-searches a resolved or
 * recently-attempted row). Filters in application code, same "hundreds of sources" scale precedent
 * as `listEnabledJobSourcesDueForCrawl`/`listJobrightEnrichmentCandidates`. Never selects
 * `RESOLVED_HIGH_CONFIDENCE` rows — those are handled by revalidation, not re-resolution.
 */
export async function listOfficialPostingResolutionCandidates(
  supabase: CareerOsSupabaseClient,
  jobrightSourceIds: string[],
  options: { retryAfterMs: number; maxCount: number; now?: Date },
): Promise<OfficialPostingResolutionCandidate[]> {
  if (jobrightSourceIds.length === 0) return [];
  const now = options.now ?? new Date();
  const retryBeforeMs = now.getTime() - options.retryAfterMs;

  const rows: {
    id: string;
    source_id: string;
    source_job_id: string;
    company_name: string;
    title: string;
    location_text: string | null;
    canonical_apply_url: string | null;
    source_url: string | null;
    apply_url: string;
    posted_at: string | null;
    resolution_status: string;
    resolution_attempt_count: number;
    resolution_last_attempt_at: string | null;
  }[] = [];
  for (const idsChunk of chunk(jobrightSourceIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select(
        'id, source_id, source_job_id, company_name, title, location_text, canonical_apply_url, source_url, apply_url, posted_at, resolution_status, resolution_attempt_count, resolution_last_attempt_at',
      )
      .eq('status', 'ACTIVE')
      .in('source_id', idsChunk);
    assertNoError(error, 'listOfficialPostingResolutionCandidates');
    rows.push(...(data ?? []));
  }

  return rows
    .filter((row) => {
      if (row.resolution_status === 'NOT_ATTEMPTED') return true;
      if (row.resolution_status === 'RESOLVED_HIGH_CONFIDENCE') return false;
      return (
        !row.resolution_last_attempt_at ||
        new Date(row.resolution_last_attempt_at).getTime() < retryBeforeMs
      );
    })
    .sort((a, b) => {
      const aAt = a.resolution_last_attempt_at ? new Date(a.resolution_last_attempt_at).getTime() : 0;
      const bAt = b.resolution_last_attempt_at ? new Date(b.resolution_last_attempt_at).getTime() : 0;
      return aAt - bAt;
    })
    .slice(0, options.maxCount)
    .map((row) => ({
      jobCatalogId: row.id,
      sourceId: row.source_id,
      sourceJobId: row.source_job_id,
      companyName: row.company_name,
      title: row.title,
      locationText: row.location_text,
      canonicalApplyUrl: row.canonical_apply_url,
      sourceUrl: row.source_url,
      applyUrl: row.apply_url,
      postedAt: row.posted_at,
      resolutionAttemptCount: row.resolution_attempt_count,
    }));
}

export interface OfficialPostingResolutionUpdate {
  resolutionStatus: 'RESOLVED_HIGH_CONFIDENCE' | 'RESOLVED_REVIEW' | 'UNRESOLVED';
  resolutionStrategy: 'SEARCH';
  resolutionConfidence: number;
  /** Only set (non-null) for RESOLVED_REVIEW — canonical_apply_url is never touched for that tier. */
  canonicalApplyUrl?: string;
  resolutionCandidateUrl?: string | null;
}

/**
 * D7.1 — persists one Strategy-B (search) resolution attempt's outcome. `canonicalApplyUrl` is
 * only ever included in the update payload for a RESOLVED_HIGH_CONFIDENCE outcome — a
 * RESOLVED_REVIEW or UNRESOLVED outcome never touches it, exactly per the task's "store candidate
 * separately... do not silently replace canonical" instruction. Always bumps
 * `resolution_attempt_count`/`resolution_last_attempt_at`, which is what drives the retry-window
 * cost control in `listOfficialPostingResolutionCandidates`.
 */
export async function recordOfficialPostingResolutionAttempt(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
  update: OfficialPostingResolutionUpdate,
  currentAttemptCount: number,
  now: Date = new Date(),
): Promise<void> {
  const payload: Database['public']['Tables']['job_catalog']['Update'] = {
    resolution_status: update.resolutionStatus,
    resolution_strategy: update.resolutionStrategy,
    resolution_confidence: update.resolutionConfidence,
    resolution_attempt_count: currentAttemptCount + 1,
    resolution_last_attempt_at: now.toISOString(),
  };
  if (update.canonicalApplyUrl !== undefined) payload.canonical_apply_url = update.canonicalApplyUrl;
  if (update.resolutionCandidateUrl !== undefined) {
    payload.resolution_candidate_url = update.resolutionCandidateUrl;
  }

  const { error } = await supabase.from('job_catalog').update(payload).eq('id', jobCatalogId);
  assertNoError(error, 'recordOfficialPostingResolutionAttempt');
}

export interface OfficialPostingRevalidationCandidate {
  jobCatalogId: string;
  companyName: string;
  title: string;
  canonicalApplyUrl: string;
  linkCheckFailures: number;
}

/**
 * D7.1 §11 — SEARCH-resolved postings due for a liveness recheck (older than
 * `validationIntervalMs` since the last resolution/recheck). CATALOG_MATCH-resolved rows are
 * deliberately excluded: they mirror an ATS-native row that its own source's normal daily sync
 * already continuously reconciles, so a separate liveness check would be redundant.
 */
export async function listResolvedPostingsForRevalidation(
  supabase: CareerOsSupabaseClient,
  jobrightSourceIds: string[],
  options: { validationIntervalMs: number; maxCount: number; now?: Date },
): Promise<OfficialPostingRevalidationCandidate[]> {
  if (jobrightSourceIds.length === 0) return [];
  const now = options.now ?? new Date();
  const staleBeforeMs = now.getTime() - options.validationIntervalMs;

  const rows: {
    id: string;
    company_name: string;
    title: string;
    canonical_apply_url: string | null;
    resolution_last_attempt_at: string | null;
    resolution_link_check_failures: number;
  }[] = [];
  for (const idsChunk of chunk(jobrightSourceIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select(
        'id, company_name, title, canonical_apply_url, resolution_last_attempt_at, resolution_link_check_failures',
      )
      .eq('status', 'ACTIVE')
      .eq('resolution_status', 'RESOLVED_HIGH_CONFIDENCE')
      .eq('resolution_strategy', 'SEARCH')
      .in('source_id', idsChunk);
    assertNoError(error, 'listResolvedPostingsForRevalidation');
    rows.push(...(data ?? []));
  }

  return rows
    .filter(
      (row) =>
        row.canonical_apply_url &&
        (!row.resolution_last_attempt_at ||
          new Date(row.resolution_last_attempt_at).getTime() < staleBeforeMs),
    )
    .slice(0, options.maxCount)
    .map((row) => ({
      jobCatalogId: row.id,
      companyName: row.company_name,
      title: row.title,
      canonicalApplyUrl: row.canonical_apply_url as string,
      linkCheckFailures: row.resolution_link_check_failures,
    }));
}

export type OfficialPostingRevalidationDemotion =
  | { to: 'RESOLVED_REVIEW'; candidateUrl: string; confidence: number }
  | { to: 'UNRESOLVED' };

/**
 * Demotes a RESOLVED_HIGH_CONFIDENCE row whose stored `canonical_apply_url` failed page
 * revalidation. Strictly a downgrade, never a promotion: the update is guarded on the row still
 * being RESOLVED_HIGH_CONFIDENCE (so a concurrent change or a re-run is a no-op), and it always
 * clears `canonical_apply_url` back to null (never to the Jobright source URL). REVIEW keeps the
 * old URL as `resolution_candidate_url` — that is the only audit trail this schema has for it; an
 * UNRESOLVED demotion (the page positively identified a different job) keeps nothing, matching the
 * resolver's own MISMATCH handling. `resolution_last_attempt_at` is bumped so the ordinary
 * retry-window cost control applies; `resolution_attempt_count` is not (this isn't a search).
 */
export async function recordOfficialPostingRevalidationDemotion(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
  demotion: OfficialPostingRevalidationDemotion,
  now: Date = new Date(),
): Promise<void> {
  const payload: Database['public']['Tables']['job_catalog']['Update'] = {
    canonical_apply_url: null,
    resolution_link_check_failures: 0,
    resolution_last_attempt_at: now.toISOString(),
    ...(demotion.to === 'RESOLVED_REVIEW'
      ? {
          resolution_status: 'RESOLVED_REVIEW',
          resolution_candidate_url: demotion.candidateUrl,
          resolution_confidence: demotion.confidence,
        }
      : { resolution_status: 'UNRESOLVED', resolution_candidate_url: null, resolution_confidence: 0 }),
  };
  const { error } = await supabase
    .from('job_catalog')
    .update(payload)
    .eq('id', jobCatalogId)
    .eq('resolution_status', 'RESOLVED_HIGH_CONFIDENCE');
  assertNoError(error, 'recordOfficialPostingRevalidationDemotion');
}

const LINK_CHECK_FAILURE_THRESHOLD = 2;

/**
 * D7.1 §11 — records one liveness-check outcome. A single failure only increments the counter
 * (never equated with closure — a transient HTTP error is not the same as the posting being gone).
 * Only at `LINK_CHECK_FAILURE_THRESHOLD` consecutive failures does this clear
 * `canonical_apply_url` back to `null` (never back to the Jobright source URL) and downgrade
 * `resolution_status` to `UNRESOLVED`, so the next scheduled resolution pass re-attempts fresh and
 * the UI's `selectJobApplyActions` falls back to "Find official posting" with zero coupling to
 * resolution state.
 */
export async function recordOfficialPostingLivenessCheck(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
  outcome: { reachable: boolean },
  currentFailures: number,
  now: Date = new Date(),
): Promise<void> {
  if (outcome.reachable) {
    const { error } = await supabase
      .from('job_catalog')
      .update({ resolution_link_check_failures: 0, resolution_last_attempt_at: now.toISOString() })
      .eq('id', jobCatalogId);
    assertNoError(error, 'recordOfficialPostingLivenessCheck (reachable)');
    return;
  }

  const nextFailures = currentFailures + 1;
  const payload: Database['public']['Tables']['job_catalog']['Update'] = {
    resolution_link_check_failures: nextFailures,
    resolution_last_attempt_at: now.toISOString(),
  };
  if (nextFailures >= LINK_CHECK_FAILURE_THRESHOLD) {
    payload.canonical_apply_url = null;
    payload.resolution_status = 'UNRESOLVED';
  }
  const { error } = await supabase.from('job_catalog').update(payload).eq('id', jobCatalogId);
  assertNoError(error, 'recordOfficialPostingLivenessCheck (unreachable)');
}

/**
 * D7.1 — looks up which of a batch of `sourceJobId`s already have their own `job_catalog` row
 * under `sourceId`, keyed by `sourceJobId`. Used by `sync-source.ts`'s ongoing per-sync
 * cross-source-dedupe check to decide whether a newly-matching Jobright candidate needs a full
 * merge (an existing row, which must stop being independently visible/ranked) or the simpler
 * "never insert a second row" suppression that already handles a genuinely new candidate.
 */
export async function getJobCatalogIdsBySourceJobIds(
  supabase: CareerOsSupabaseClient,
  sourceId: string,
  sourceJobIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (sourceJobIds.length === 0) return result;
  for (const idsChunk of chunk(sourceJobIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select('id, source_job_id')
      .eq('source_id', sourceId)
      .in('source_job_id', idsChunk);
    assertNoError(error, 'getJobCatalogIdsBySourceJobIds');
    for (const row of data ?? []) result.set(row.source_job_id, row.id);
  }
  return result;
}

export interface JobCatalogEnrichmentSnapshot {
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/**
 * D7 §9-10 — the previously-enriched fields (if any) for a batch of `job_catalog` rows under one
 * Jobright source, keyed by `source_job_id`. Exists so the orchestrator's periodic README resync
 * can carry a row's already-enriched description/salary forward into the recomputed content hash
 * instead of silently reverting it to null: the raw README table never supplies these fields, so
 * without this lookup every normal resync would recompute a content hash from `description: null`
 * and overwrite an enriched row right back to its README-only state (docs/JOB_DISCOVERY.md
 * "Jobright enrichment persistence").
 */
export async function listJobCatalogEnrichmentSnapshots(
  supabase: CareerOsSupabaseClient,
  sourceId: string,
  sourceJobIds: string[],
): Promise<Map<string, JobCatalogEnrichmentSnapshot>> {
  const result = new Map<string, JobCatalogEnrichmentSnapshot>();
  if (sourceJobIds.length === 0) return result;
  for (const idsChunk of chunk(sourceJobIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select(
        'source_job_id, description, responsibilities, qualifications, salary_min, salary_max, salary_currency',
      )
      .eq('source_id', sourceId)
      .in('source_job_id', idsChunk);
    assertNoError(error, 'listJobCatalogEnrichmentSnapshots');
    for (const row of data ?? []) {
      result.set(row.source_job_id, {
        description: row.description,
        responsibilities: row.responsibilities,
        qualifications: row.qualifications,
        salaryMin: row.salary_min,
        salaryMax: row.salary_max,
        salaryCurrency: row.salary_currency,
      });
    }
  }
  return result;
}

export interface JobrightEnrichmentCandidate {
  jobCatalogId: string;
  applyUrl: string;
}

/**
 * D7 §9-10 — the bounded set of ACTIVE Jobright-sourced rows that still need (or are due for a
 * refresh of) detail-page enrichment: never-yet-enriched rows (`description IS NULL`, since the
 * README table never supplies one) plus rows whose last enrichment write is older than
 * `staleAfterMs`. Filters in application code rather than a PostgREST `.or()` filter string —
 * same "hundreds of sources" scale precedent as `listEnabledJobSourcesDueForCrawl`'s own doc
 * comment. Deterministically ordered (never-enriched rows first, then oldest-enriched first) so a
 * bounded `maxCount` always makes the same forward progress across runs.
 */
export async function listJobrightEnrichmentCandidates(
  supabase: CareerOsSupabaseClient,
  jobrightSourceIds: string[],
  options: { staleAfterMs: number; maxCount: number; now?: Date },
): Promise<JobrightEnrichmentCandidate[]> {
  if (jobrightSourceIds.length === 0) return [];
  const now = options.now ?? new Date();
  const staleBeforeMs = now.getTime() - options.staleAfterMs;

  const rows: { id: string; apply_url: string; description: string | null; content_updated_at: string }[] = [];
  for (const idsChunk of chunk(jobrightSourceIds, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('job_catalog')
      .select('id, apply_url, description, content_updated_at')
      .eq('status', 'ACTIVE')
      .in('source_id', idsChunk);
    assertNoError(error, 'listJobrightEnrichmentCandidates');
    rows.push(...(data ?? []));
  }

  return rows
    .filter((row) => row.description === null || new Date(row.content_updated_at).getTime() < staleBeforeMs)
    .sort((a, b) => {
      if (a.description === null && b.description !== null) return -1;
      if (a.description !== null && b.description === null) return 1;
      return new Date(a.content_updated_at).getTime() - new Date(b.content_updated_at).getTime();
    })
    .slice(0, options.maxCount)
    .map((row) => ({ jobCatalogId: row.id, applyUrl: row.apply_url }));
}

export interface JobCatalogEnrichmentUpdate {
  description?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  employmentType?: string | null;
  workplaceType?: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  locationText?: string | null;
  normalizedLocation?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  postedAt?: string | null;
  contentHash: string;
}

/**
 * D7 §10 — the enrichment stage's one write: a targeted update to fields the Jobright detail
 * page's structured data can genuinely supply, never touching `source_id`/`source_job_id`/
 * `status`/lifecycle fields. `contentHash` is always recomputed by the caller
 * (`computeJobCatalogContentHash`) and written here so the next feature-extraction pass picks up
 * the richer content — this is the only way enrichment becomes visible to Match/Coverage.
 */
export async function updateJobCatalogEnrichment(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
  update: JobCatalogEnrichmentUpdate,
  now: Date = new Date(),
): Promise<void> {
  const payload: Database['public']['Tables']['job_catalog']['Update'] = {
    content_hash: update.contentHash,
    content_updated_at: now.toISOString(),
  };
  if (update.description !== undefined) payload.description = update.description;
  if (update.responsibilities !== undefined) payload.responsibilities = update.responsibilities;
  if (update.qualifications !== undefined) payload.qualifications = update.qualifications;
  if (update.employmentType !== undefined) payload.employment_type = update.employmentType;
  if (update.workplaceType !== undefined) payload.workplace_type = update.workplaceType;
  if (update.locationText !== undefined) payload.location_text = update.locationText;
  if (update.normalizedLocation !== undefined) payload.normalized_location = update.normalizedLocation;
  if (update.city !== undefined) payload.city = update.city;
  if (update.stateRegion !== undefined) payload.state_region = update.stateRegion;
  if (update.country !== undefined) payload.country = update.country;
  if (update.salaryMin !== undefined) payload.salary_min = update.salaryMin;
  if (update.salaryMax !== undefined) payload.salary_max = update.salaryMax;
  if (update.salaryCurrency !== undefined) payload.salary_currency = update.salaryCurrency;
  if (update.postedAt !== undefined) payload.posted_at = update.postedAt;

  const { error } = await supabase.from('job_catalog').update(payload).eq('id', jobCatalogId);
  assertNoError(error, 'updateJobCatalogEnrichment');
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
