import { z } from 'zod';
import { jobCatalogWorkplaceTypeSchema } from './job-catalog';

/**
 * The shape handed from packages/discovery's normalization step to packages/database's
 * `upsertDiscoveredJobsForSource` (docs/JOB_DISCOVERY.md "Normalization" / "Upsert semantics") —
 * a `RawDiscoveredJob` after title/location normalization, URL canonicalization, dedupe
 * fingerprinting, and content hashing have all already run. Lives in packages/shared (not
 * packages/discovery) purely so packages/database can type its own write-layer input without
 * depending on packages/discovery.
 */
export const normalizedDiscoveredJobSchema = z.object({
  sourceJobId: z.string().min(1),

  companyName: z.string().min(1),

  title: z.string().min(1),
  normalizedTitle: z.string().min(1),

  locationText: z.string().nullable(),
  normalizedLocation: z.string().nullable(),
  city: z.string().nullable(),
  stateRegion: z.string().nullable(),
  country: z.string().nullable(),

  workplaceType: jobCatalogWorkplaceTypeSchema.nullable(),
  employmentType: z.string().nullable(),

  description: z.string().nullable(),
  responsibilities: z.string().nullable(),
  qualifications: z.string().nullable(),

  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),

  applyUrl: z.string().min(1),
  sourceUrl: z.string().nullable(),
  canonicalApplyUrl: z.string().nullable(),
  dedupeFingerprint: z.string().nullable(),

  postedAt: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),

  contentHash: z.string().min(1),
});
export type NormalizedDiscoveredJob = z.infer<typeof normalizedDiscoveredJobSchema>;
