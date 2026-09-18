import type { JobSource, RawDiscoveredJob } from '@career-os/shared';

/** Why one individual provider item was rejected — never why the whole crawl failed. */
export interface RejectedJob {
  reason: string;
  raw: unknown;
}

/**
 * The result of one adapter's `fetchJobs` call (docs/JOB_DISCOVERY.md "Ingestion orchestrator").
 * SUCCESS/FAILURE distinguishes "the provider request itself was incomplete/failed" from "one
 * malformed job among otherwise-valid ones" — only a SUCCESS result may ever drive closed-job
 * reconciliation (docs/JOB_DISCOVERY.md "Closed-job lifecycle").
 *
 * `NOT_MODIFIED` (D7) — a conditional-request 304: the provider confirmed nothing changed since
 * the cached `etag`. This is deliberately its own status, never folded into `SUCCESS` with an
 * empty `jobs` array — an empty-but-successful fetch legitimately drives reconciliation (nothing
 * seen this sync == truly gone), which would be exactly wrong for "the source didn't even send
 * new data to check." The orchestrator records crawl success but skips upsert/reconcile entirely
 * for a `NOT_MODIFIED` result. Only an adapter that actually supports conditional requests ever
 * returns this — Greenhouse/Lever/Ashby never do.
 */
export type AdapterFetchResult =
  | { status: 'SUCCESS'; jobs: RawDiscoveredJob[]; rejected: RejectedJob[]; etag?: string | null }
  | { status: 'FAILURE'; jobs: []; rejected: RejectedJob[]; error: string }
  | { status: 'NOT_MODIFIED'; etag: string | null };

/** The one shared contract every provider-specific adapter implements (docs/JOB_DISCOVERY.md
 * "Adapter architecture") — provider response shapes never leak past this boundary. `etag` (D7)
 * is additive and optional — the three existing ATS adapters, and every existing test call site
 * that constructs a narrower fetchJobs argument by hand, simply omit it; only a source whose
 * adapter supports conditional requests reads it to send `If-None-Match`. */
export interface JobSourceAdapter {
  fetchJobs(
    source: Pick<JobSource, 'sourceType' | 'sourceIdentifier' | 'companyName'> &
      Partial<Pick<JobSource, 'etag'>>,
  ): Promise<AdapterFetchResult>;
}
