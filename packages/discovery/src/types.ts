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
 */
export type AdapterFetchResult =
  | { status: 'SUCCESS'; jobs: RawDiscoveredJob[]; rejected: RejectedJob[] }
  | { status: 'FAILURE'; jobs: []; rejected: RejectedJob[]; error: string };

/** The one shared contract every provider-specific adapter implements (docs/JOB_DISCOVERY.md
 * "Adapter architecture") — provider response shapes never leak past this boundary. */
export interface JobSourceAdapter {
  fetchJobs(
    source: Pick<JobSource, 'sourceType' | 'sourceIdentifier' | 'companyName'>,
  ): Promise<AdapterFetchResult>;
}
