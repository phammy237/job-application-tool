import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { jobSourceTypeSchema } from './job-source';

export const jobCatalogWorkplaceTypeSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE']);
export type JobCatalogWorkplaceType = z.infer<typeof jobCatalogWorkplaceTypeSchema>;

/**
 * Lifecycle (docs/JOB_DISCOVERY.md "Freshness / closed-job lifecycle"):
 * ACTIVE -> (one missed successful crawl) -> POSSIBLY_CLOSED -> (one more) -> CLOSED.
 * Reappearing at any point resets straight back to ACTIVE with misses = 0.
 */
export const jobCatalogStatusSchema = z.enum(['ACTIVE', 'POSSIBLY_CLOSED', 'CLOSED']);
export type JobCatalogStatus = z.infer<typeof jobCatalogStatusSchema>;

/**
 * D7 cross-source dedupe (docs/JOB_DISCOVERY.md "Cross-source dedupe") — one entry per duplicate
 * posting detected from a *different* source and suppressed rather than inserted as a second
 * `job_catalog` row. Provenance only: never read by feature extraction or ranking, and never
 * used to change the canonical row's own `source_id`/`source_job_id` identity.
 */
export const crossSourceObservationSchema = z.object({
  provider: jobSourceTypeSchema,
  sourceIdentifier: z.string().min(1),
  sourceJobId: z.string().min(1),
  sourceUrl: z.string().nullable(),
  observedAt: isoDateTimeSchema,
});
export type CrossSourceObservation = z.infer<typeof crossSourceObservationSchema>;

/**
 * The persisted `job_catalog` row shape — global, mutable, platform-owned "what jobs currently
 * exist" data. NOT the user-owned `jobs`/`job_snapshots` system (docs/DATA_MODEL.md); see
 * docs/JOB_DISCOVERY.md for the full distinction.
 */
export const jobCatalogEntrySchema = z.object({
  id: uuidSchema,
  sourceId: uuidSchema,
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
  crossSourceObservations: z.array(crossSourceObservationSchema).default([]),

  postedAt: isoDateTimeSchema.nullable(),
  sourceUpdatedAt: isoDateTimeSchema.nullable(),

  firstSeenAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  contentUpdatedAt: isoDateTimeSchema,

  consecutiveMisses: z.number().int().nonnegative(),
  status: jobCatalogStatusSchema,
  closedAt: isoDateTimeSchema.nullable(),

  contentHash: z.string().min(1),

  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type JobCatalogEntry = z.infer<typeof jobCatalogEntrySchema>;
