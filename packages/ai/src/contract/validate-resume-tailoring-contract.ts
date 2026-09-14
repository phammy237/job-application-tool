import { resumeTailoringPlanSchema, type ResumeTailoringPlan } from '@career-os/shared';

export type ResumeTailoringContractValidationResult =
  | { status: 'ok'; plan: ResumeTailoringPlan }
  /** Malformed JSON or a schema violation (bad shape, unknown operation type, ADD_BULLET with no
   * citation, a cap exceeded) — the same shallow, structural check every other pipeline's
   * contract validator performs first. */
  | { status: 'rejected'; reason: 'validation_failed' };

/**
 * The shallow half of résumé-tailoring validation: (1) is this valid JSON, (2) does it match
 * `resumeTailoringPlanSchema` (packages/shared) at all. This is intentionally NOT where id-
 * allowlist checks, the conflict matrix, target-index bounds, or numeric/technology grounding are
 * enforced — those require the base résumé and this request's own allowlists, which only
 * `generate-resume-tailoring-plan.ts` has in scope; it calls the shared, pure
 * `validateResumeTailoringPlan` for that deeper pass immediately after this one succeeds. Same
 * two-layer split every other pipeline in this package uses (a narrow per-pipeline contract
 * validator here, deeper semantic checks in the orchestrator).
 */
export function validateResumeTailoringContract(
  rawText: string,
): ResumeTailoringContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = resumeTailoringPlanSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  return { status: 'ok', plan: parsed.data };
}
