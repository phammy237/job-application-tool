import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * The persisted `discovery_eligibility_profiles` row (docs/JOB_DISCOVERY.md "Eligibility
 * profile") — only explicit, self-reported user answers, never inferred (CLAUDE.md "never invent
 * a fact" applied to immigration/eligibility data specifically: Career OS never guesses
 * citizenship/authorization/sponsorship need from any other signal). Every field is nullable —
 * `null` means "the user hasn't told us," which is exactly what makes the corresponding
 * Eligibility check inapplicable (omitted from the checks array) rather than UNKNOWN-as-a-status.
 *
 * `currentlyAuthorizedToWork`, `requiresSponsorshipNow`, and `requiresSponsorshipFuture` are
 * deliberately three separate fields, never collapsed into one — an F-1/OPT-style candidate is
 * commonly CURRENTLY authorized to work (via OPT) while also genuinely REQUIRING future employer
 * sponsorship (e.g. H-1B) to remain authorized long-term; conflating those two would misrepresent
 * a very common real situation. CPT/OPT status is never assumed to satisfy every employer's stated
 * requirement — the user's own explicit answers are the only input, not a legal inference engine.
 */
export const discoveryEligibilityProfileSchema = z.object({
  userId: uuidSchema,
  currentlyAuthorizedToWork: z.boolean().nullable(),
  requiresSponsorshipNow: z.boolean().nullable(),
  requiresSponsorshipFuture: z.boolean().nullable(),
  isUsCitizen: z.boolean().nullable(),
  hasActiveSecurityClearance: z.boolean().nullable(),
  eligibleToObtainSecurityClearance: z.boolean().nullable(),
  graduationYear: z.number().int().min(2000).max(2100).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DiscoveryEligibilityProfile = z.infer<typeof discoveryEligibilityProfileSchema>;

export const discoveryEligibilityProfileUpdateSchema = discoveryEligibilityProfileSchema
  .omit({ userId: true, createdAt: true, updatedAt: true })
  .partial();
export type DiscoveryEligibilityProfileUpdate = z.infer<
  typeof discoveryEligibilityProfileUpdateSchema
>;
