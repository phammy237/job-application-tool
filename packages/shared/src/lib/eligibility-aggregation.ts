import type { EligibilityCheck, EligibilityResult, EligibilityStatus } from '../schemas/eligibility-check';

/**
 * Deterministic overall-eligibility aggregation (docs/JOB_DISCOVERY.md "Overall eligibility
 * derivation"):
 *
 *   - ANY check is CONFLICT       -> overall CONFLICT
 *   - no conflicts, but ANY check is UNKNOWN -> overall UNKNOWN
 *   - every included check is ELIGIBLE (or there are no applicable checks at all) -> ELIGIBLE
 *
 * `checks` is expected to already contain only *applicable* checks — a check that isn't relevant
 * to this user/posting combination (the user never answered the relevant eligibility question,
 * or the posting never made the relevant statement) is omitted entirely by each individual check
 * evaluator, never included as a synthetic third "not applicable" status. An empty `checks` array
 * therefore aggregates to ELIGIBLE — vacuously true: "Career OS found no conflict among the
 * explicit eligibility requirements it could evaluate" holds trivially when there was nothing to
 * evaluate. This is NOT a claim that the employer will accept the applicant; see
 * docs/JOB_DISCOVERY.md for the full documented semantics D5 should surface carefully.
 */
export function aggregateEligibility(checks: readonly EligibilityCheck[]): EligibilityResult {
  const overallStatus: EligibilityStatus = checks.some((check) => check.status === 'CONFLICT')
    ? 'CONFLICT'
    : checks.some((check) => check.status === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'ELIGIBLE';

  return { overallStatus, checks: [...checks] };
}
