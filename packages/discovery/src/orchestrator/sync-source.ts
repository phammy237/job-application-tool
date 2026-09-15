import type { CareerOsSupabaseClient } from '@career-os/database';
import {
  recordJobSourceCrawlFailure,
  recordJobSourceCrawlSuccess,
  reconcileMissingJobsForSource,
  upsertDiscoveredJobsForSource,
} from '@career-os/database';
import type { JobSource, RawDiscoveredJob } from '@career-os/shared';
import { ashbyAdapter } from '../adapters/ashby';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { leverAdapter } from '../adapters/lever';
import { normalizeDiscoveredJob } from '../normalize';
import type { JobSourceAdapter } from '../types';

const ADAPTERS: Record<JobSource['sourceType'], JobSourceAdapter> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
};

export interface SourceSyncResult {
  sourceId: string;
  companyName: string;
  provider: JobSource['sourceType'];
  outcome: 'SUCCESS' | 'FAILURE';
  error?: string;
  durationMs: number;
  jobsFetched: number;
  new: number;
  updated: number;
  unchanged: number;
  possiblyClosed: number;
  closed: number;
  reopened: number;
  rejected: number;
}

/**
 * Syncs exactly one source, end to end (docs/JOB_DISCOVERY.md "Ingestion orchestrator"):
 * select adapter -> fetch -> (on SUCCESS) dedupe by provider id -> normalize -> upsert -> ONLY
 * THEN reconcile missing jobs -> record source crawl health. A FAILURE result from the adapter
 * never reaches the upsert/reconcile step and never touches any existing job_catalog row's
 * status/misses — this is the single mechanism that keeps a provider outage from mass-closing
 * jobs (docs/JOB_DISCOVERY.md "Closed-job lifecycle" scenario F).
 */
export async function syncSource(
  supabase: CareerOsSupabaseClient,
  source: JobSource,
  now: Date = new Date(),
): Promise<SourceSyncResult> {
  const start = Date.now();
  const adapter = ADAPTERS[source.sourceType];

  const fetchResult = await adapter.fetchJobs(source);

  if (fetchResult.status === 'FAILURE') {
    await recordJobSourceCrawlFailure(supabase, source.id, fetchResult.error, now);
    return {
      sourceId: source.id,
      companyName: source.companyName,
      provider: source.sourceType,
      outcome: 'FAILURE',
      error: fetchResult.error,
      durationMs: Date.now() - start,
      jobsFetched: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      possiblyClosed: 0,
      closed: 0,
      reopened: 0,
      rejected: fetchResult.rejected.length,
    };
  }

  // Deterministic dedupe of a duplicate provider id within one response
  // (docs/JOB_DISCOVERY.md scenario H) — first occurrence wins, the rest count as rejected.
  const seen = new Map<string, RawDiscoveredJob>();
  let duplicateCount = 0;
  for (const raw of fetchResult.jobs) {
    if (seen.has(raw.sourceJobId)) {
      duplicateCount += 1;
      continue;
    }
    seen.set(raw.sourceJobId, raw);
  }
  const uniqueRaw = [...seen.values()];

  const normalized = await Promise.all(uniqueRaw.map((raw) => normalizeDiscoveredJob(raw)));

  const upsertSummary = await upsertDiscoveredJobsForSource(supabase, source.id, normalized, now);

  // Reconciliation happens ONLY here, after upsert of a fully-successful fetch — never on a
  // FAILURE result (handled entirely above, before this point is ever reached).
  const reconcileSummary = await reconcileMissingJobsForSource(
    supabase,
    source.id,
    normalized.map((job) => job.sourceJobId),
    now,
  );

  await recordJobSourceCrawlSuccess(supabase, source.id, now);

  return {
    sourceId: source.id,
    companyName: source.companyName,
    provider: source.sourceType,
    outcome: 'SUCCESS',
    durationMs: Date.now() - start,
    jobsFetched: fetchResult.jobs.length,
    new: upsertSummary.new,
    updated: upsertSummary.updated,
    unchanged: upsertSummary.unchanged,
    reopened: upsertSummary.reopened,
    possiblyClosed: reconcileSummary.possiblyClosed,
    closed: reconcileSummary.closed,
    rejected: fetchResult.rejected.length + duplicateCount,
  };
}
