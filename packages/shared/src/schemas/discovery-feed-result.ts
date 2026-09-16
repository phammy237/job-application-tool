import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { normalizedEmploymentTypeSchema, normalizedWorkplaceTypeSchema, roleFamilySchema } from './job-role-taxonomy';
import { eligibilityStatusSchema } from './eligibility-check';

/** One `/discover` feed row — the lean, list-card shape `list_own_discovery_feed` (migration
 * 0031) returns. Deliberately excludes the full score/eligibility breakdown (that's the detail
 * page's job, fetched per-job only when opened, never bundled into every list row). */
export const discoveryFeedResultItemSchema = z.object({
  jobCatalogId: uuidSchema,
  title: z.string().min(1),
  companyName: z.string().min(1),
  locationText: z.string().nullable(),
  normalizedWorkplaceType: normalizedWorkplaceTypeSchema,
  normalizedEmploymentType: normalizedEmploymentTypeSchema,
  roleFamily: roleFamilySchema,
  firstSeenAt: isoDateTimeSchema,
  matchScore: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100),
  eligibilityStatus: eligibilityStatusSchema,
});
export type DiscoveryFeedResultItem = z.infer<typeof discoveryFeedResultItemSchema>;
