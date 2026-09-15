import {
  companyResearchPlanContractSchema,
  type CompanyResearchPlanContract,
} from '@career-os/shared';

export type CompanyResearchContractValidationResult =
  | { status: 'ok'; plan: CompanyResearchPlanContract }
  | { status: 'rejected'; reason: 'validation_failed' };

/**
 * The shallow half of company-research validation — same two-layer split every other pipeline in
 * this package uses (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §16, mirroring
 * `validate-resume-tailoring-contract.ts`): (1) is this valid JSON, (2) does it match
 * `companyResearchPlanContractSchema` at all. Source/requirement-id allowlist checks happen one
 * layer up, in `validateCompanyResearchPlan` (packages/shared), which has this request's actual
 * allowlists in scope.
 */
export function validateCompanyResearchContract(
  rawText: string,
): CompanyResearchContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = companyResearchPlanContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  return { status: 'ok', plan: parsed.data };
}
