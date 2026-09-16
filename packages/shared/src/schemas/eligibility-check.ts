import { z } from 'zod';

/**
 * Eligibility check types (docs/JOB_DISCOVERY.md "Eligibility check types") — deliberately
 * limited to what can be evaluated deterministically and safely from explicit posting language
 * and explicit user self-report. "Years of experience" and skill mismatch are NEVER eligibility
 * checks (CLAUDE.md/design spec: those belong to Match, not Eligibility — a JD's "3+ years" is
 * routinely wishlist language, not a hard legal bar).
 */
export const eligibilityCheckTypeSchema = z.enum([
  'SPONSORSHIP',
  'WORK_AUTHORIZATION',
  'CITIZENSHIP',
  'SECURITY_CLEARANCE',
  'GRADUATION_WINDOW',
]);
export type EligibilityCheckType = z.infer<typeof eligibilityCheckTypeSchema>;

/**
 * "ELIGIBLE" means Career OS found no conflict among the explicit eligibility requirements it
 * could evaluate from this posting and the user's self-reported profile — it is NOT a claim that
 * "the employer will accept this applicant." See docs/JOB_DISCOVERY.md "Overall eligibility
 * derivation" for the full documented semantics.
 */
export const eligibilityStatusSchema = z.enum(['ELIGIBLE', 'UNKNOWN', 'CONFLICT']);
export type EligibilityStatus = z.infer<typeof eligibilityStatusSchema>;

/** One individual, explainable check — always carries a stable `reasonCode` and, when the
 * conclusion came from posting text, a bounded `evidenceText` snippet. A check that isn't
 * relevant to this user/posting combination is simply omitted from the checks array entirely
 * (docs/JOB_DISCOVERY.md "User hard preference exclusions" / "Overall eligibility derivation") —
 * there is no fourth "not applicable" status. */
export const eligibilityCheckSchema = z.object({
  type: eligibilityCheckTypeSchema,
  status: eligibilityStatusSchema,
  reasonCode: z.string().min(1),
  explanation: z.string().min(1),
  evidenceText: z.string().nullable(),
  sourceField: z.string().nullable(),
});
export type EligibilityCheck = z.infer<typeof eligibilityCheckSchema>;

export const eligibilityResultSchema = z.object({
  overallStatus: eligibilityStatusSchema,
  checks: z.array(eligibilityCheckSchema),
});
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;
