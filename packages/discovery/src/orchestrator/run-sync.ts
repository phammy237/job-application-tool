import type { CareerOsSupabaseClient } from '@career-os/database';
import type { JobSource } from '@career-os/shared';
import { syncSource, type SourceSyncResult } from './sync-source';

export interface RunDiscoverySyncOptions {
  /** Called once per source, in order, as soon as that source's sync finishes — lets the CLI
   * print a structured per-source log line without waiting for the whole run. */
  onSourceResult?: (result: SourceSyncResult) => void;
}

export interface RunDiscoverySyncSummary {
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsFetched: number;
  new: number;
  updated: number;
  unchanged: number;
  possiblyClosed: number;
  closed: number;
  reopened: number;
  rejected: number;
  results: SourceSyncResult[];
}

const NUMERIC_KEYS = [
  'jobsFetched',
  'new',
  'updated',
  'unchanged',
  'possiblyClosed',
  'closed',
  'reopened',
  'rejected',
] as const;

/**
 * Runs `syncSource` over every given source, isolating one source's failure from the rest
 * (docs/JOB_DISCOVERY.md "Failure isolation") — a source whose adapter call throws unexpectedly
 * (rather than returning the normal FAILURE result `syncSource` already handles) is caught here
 * and reported as that one source's failure, never aborting the loop.
 *
 * Deliberately does NOT decide the process exit code itself — that is the CLI's call (see
 * `docs/JOB_DISCOVERY.md` "Failure isolation": a single 404 must not fail the whole daily run,
 * but Supabase auth being completely broken must). This function only ever fetches/writes through
 * the `supabase` client it's given; if that client's credentials are entirely invalid, every
 * `syncSource` call fails with the same underlying error, which is visible in `results` and
 * `sourcesFailed`, not silently swallowed — and a catastrophic failure *before* this function
 * is even called (e.g. failing to list which sources are due) is never caught here at all, so it
 * propagates and crashes the CLI outright, exactly the "fail the run" behavior the source list
 * lookup itself needs.
 */
export async function runDiscoverySync(
  supabase: CareerOsSupabaseClient,
  sources: JobSource[],
  options: RunDiscoverySyncOptions = {},
): Promise<RunDiscoverySyncSummary> {
  const results: SourceSyncResult[] = [];

  for (const source of sources) {
    let result: SourceSyncResult;
    try {
      result = await syncSource(supabase, source);
    } catch (error) {
      result = {
        sourceId: source.id,
        companyName: source.companyName,
        provider: source.sourceType,
        outcome: 'FAILURE',
        error: `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: 0,
        jobsFetched: 0,
        new: 0,
        updated: 0,
        unchanged: 0,
        possiblyClosed: 0,
        closed: 0,
        reopened: 0,
        rejected: 0,
      };
    }
    results.push(result);
    options.onSourceResult?.(result);
  }

  const summary: RunDiscoverySyncSummary = {
    sourcesAttempted: results.length,
    sourcesSucceeded: results.filter((r) => r.outcome === 'SUCCESS').length,
    sourcesFailed: results.filter((r) => r.outcome === 'FAILURE').length,
    jobsFetched: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    possiblyClosed: 0,
    closed: 0,
    reopened: 0,
    rejected: 0,
    results,
  };
  for (const key of NUMERIC_KEYS) {
    summary[key] = results.reduce((total, r) => total + r[key], 0);
  }
  return summary;
}
