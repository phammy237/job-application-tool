import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { normalizedEmploymentTypeSchema, normalizedWorkplaceTypeSchema, roleFamilySchema } from './job-role-taxonomy';
import { eligibilityStatusSchema } from './eligibility-check';
import { applicationStatusSchema } from './application';

/** One `/discover` feed row — the lean, list-card shape `list_own_discovery_feed` (migration
 * 0031) returns. Deliberately excludes the full score/eligibility breakdown (that's the detail
 * page's job, fetched per-job only when opened, never bundled into every list row).
 *
 * `trackedApplicationId`/`trackedApplicationStatus` were added for D6 (migration 0032) — a single
 * LEFT JOIN inside the feed RPC itself, not a per-card lookup (docs/JOB_DISCOVERY.md "Discovery
 * list integration"). Both null means untracked; this never affects `matchScore`/`coverage`/
 * `eligibilityStatus` or the row's position in the feed — application status cannot influence
 * discovery ranking. */
export const discoveryFeedResultItemSchema = z.object({
  jobCatalogId: uuidSchema,
  title: z.string().min(1),
  companyName: z.string().min(1),
  locationText: z.string().nullable(),
  normalizedWorkplaceType: normalizedWorkplaceTypeSchema,
  normalizedEmploymentType: normalizedEmploymentTypeSchema,
  /** The canonical internship classification (packages/shared/src/lib/
   * extract-job-catalog-features.ts) -- broader than `normalizedEmploymentType === 'INTERNSHIP'`
   * alone (it also catches a title-evident internship whose ATS-provided employment_type is
   * missing/generic, e.g. Greenhouse never sets employment_type at all). The Discover feed's own
   * Internship filter and job-card label both key off this field, never off
   * `normalizedEmploymentType` directly, so the two can never disagree about which cards are
   * internships. */
  isInternship: z.boolean(),
  roleFamily: roleFamilySchema,
  firstSeenAt: isoDateTimeSchema,
  matchScore: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100),
  eligibilityStatus: eligibilityStatusSchema,
  trackedApplicationId: uuidSchema.nullable(),
  trackedApplicationStatus: applicationStatusSchema.nullable(),
  /** D7.1 — the three URL fields `selectJobApplyActions` (packages/shared) needs to decide a
   * card's primary apply action without a separate per-card fetch. `applyUrl` is the only one of
   * the three guaranteed non-empty (every adapter requires it); `canonicalApplyUrl`/`sourceUrl`
   * mirror `job_catalog`'s own nullable columns exactly. */
  canonicalApplyUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  applyUrl: z.string().min(1),
});
export type DiscoveryFeedResultItem = z.infer<typeof discoveryFeedResultItemSchema>;
