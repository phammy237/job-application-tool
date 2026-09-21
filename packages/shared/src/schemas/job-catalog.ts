import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { jobSourceTypeSchema } from './job-source';

export const jobCatalogWorkplaceTypeSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE']);
export type JobCatalogWorkplaceType = z.infer<typeof jobCatalogWorkplaceTypeSchema>;

/**
 * Lifecycle (docs/JOB_DISCOVERY.md "Freshness / closed-job lifecycle"):
 * ACTIVE -> (one missed successful crawl) -> POSSIBLY_CLOSED -> (one more) -> CLOSED.
 * Reappearing at any point resets straight back to ACTIVE with misses = 0.
 *
 * `MERGED` (D7.1) — a terminal state distinct from CLOSED: this row's real-world job is now
 * tracked canonically under a *different* job_catalog row (an ATS-native duplicate discovered
 * after this row was already ingested — see `official-posting-resolution.ts`). The row and its
 * content are retained for provenance, but it is permanently excluded from ranking
 * (`listActiveJobsWithFeatures` only selects ACTIVE) and — unlike CLOSED — must never be reopened
 * by its own source's normal resync, since a merged Jobright row's own source_job_id keeps
 * reappearing in its README every day.
 */
export const jobCatalogStatusSchema = z.enum(['ACTIVE', 'POSSIBLY_CLOSED', 'CLOSED', 'MERGED']);
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
 * D7.1 official-posting-resolution status (docs/JOB_DISCOVERY.md "Official posting resolution") —
 * backend bookkeeping only. `NOT_ATTEMPTED` is the default for every row, including every
 * ATS-native one (resolution only ever runs for Jobright-sourced rows); the UI never reads this
 * field, it classifies `canonicalApplyUrl`'s own host instead (`classifyJobPostingHost`) so an
 * ATS-native row needs zero special-casing.
 */
export const jobCatalogResolutionStatusSchema = z.enum([
  'NOT_ATTEMPTED',
  'RESOLVED_HIGH_CONFIDENCE',
  'RESOLVED_REVIEW',
  'UNRESOLVED',
]);
export type JobCatalogResolutionStatus = z.infer<typeof jobCatalogResolutionStatusSchema>;

export const jobCatalogResolutionStrategySchema = z.enum(['CATALOG_MATCH', 'SEARCH']);
export type JobCatalogResolutionStrategy = z.infer<typeof jobCatalogResolutionStrategySchema>;

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

  resolutionStatus: jobCatalogResolutionStatusSchema,
  resolutionStrategy: jobCatalogResolutionStrategySchema.nullable(),
  resolutionConfidence: z.number().min(0).max(100).nullable(),
  resolutionCandidateUrl: z.string().nullable(),
  resolutionAttemptCount: z.number().int().nonnegative(),
  resolutionLastAttemptAt: isoDateTimeSchema.nullable(),
  resolutionLinkCheckFailures: z.number().int().nonnegative(),

  contentHash: z.string().min(1),

  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type JobCatalogEntry = z.infer<typeof jobCatalogEntrySchema>;
