import type { JobInput } from './job';
import { jobInputSchema } from './job';

/**
 * The payload the extension's content script produces and POST /api/jobs/analyze accepts.
 * Aliased directly to jobInputSchema rather than duplicated — the shapes are identical (the
 * extraction *is* a jobs row minus id/userId/timestamps) and keeping one schema avoids the two
 * drifting out of sync as the jobs table evolves.
 */
export const jobExtractionPayloadSchema = jobInputSchema;
export type JobExtractionPayload = JobInput;
