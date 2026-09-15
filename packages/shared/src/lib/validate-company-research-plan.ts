import type {
  CompanyResearchFindingContract,
  CompanyResearchPlanContract,
} from '../schemas/company-research-contract';

export type CompanyResearchPlanRejectionReason =
  'unknown_source_id' | 'unknown_requirement_id' | 'no_findings';

export type ValidateCompanyResearchPlanResult =
  | { status: 'ok'; findings: CompanyResearchFindingContract[] }
  | { status: 'rejected'; reason: CompanyResearchPlanRejectionReason; detail: string };

export interface CompanyResearchAllowlists {
  /** Every source id actually offered in this request's prompt — request-local, not "any source
   * that exists in the database" (same posture as 7E's `factIds` allowlist). */
  sourceIds: ReadonlySet<string>;
  /** Every requirement id actually offered in this request's prompt — either real
   * `requirement_evidence_mappings.id` values or synthesized per-request ids when no mapping
   * exists (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §15/§43, same fallback 7E uses). */
  requirementIds: ReadonlySet<string>;
}

/**
 * The deep semantic validation gate for Phase 7G (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §15/
 * §25/§27) — pure, no DB/model access. Runs after `companyResearchPlanContractSchema` has already
 * confirmed shape; this checks what shape validation cannot: that every cited source/requirement
 * id was actually offered in *this* request. Any single failure rejects the *entire* plan — same
 * all-or-nothing posture as `validateResumeTailoringPlan` (docs/AI_GROUNDING.md §8).
 *
 * Note what this function deliberately does NOT do: it cannot verify that a claim is truly
 * entailed by its cited sources' text — only that the citation resolves to something real that
 * was actually offered. That is an honest, documented limit (§27: "citations are grounded
 * provenance, not mathematical proof of semantic entailment"), the same one 7E's own id-allowlist
 * validation has for candidate facts.
 */
export function validateCompanyResearchPlan(
  plan: CompanyResearchPlanContract,
  allowlists: CompanyResearchAllowlists,
): ValidateCompanyResearchPlanResult {
  if (plan.findings.length === 0) {
    return {
      status: 'rejected',
      reason: 'no_findings',
      detail: 'the model returned zero findings',
    };
  }

  for (const finding of plan.findings) {
    for (const sourceId of finding.sourceIds) {
      if (!allowlists.sourceIds.has(sourceId)) {
        return {
          status: 'rejected',
          reason: 'unknown_source_id',
          detail: `sourceId "${sourceId}" was not offered in this request`,
        };
      }
    }
    for (const requirementId of finding.requirementIds) {
      if (!allowlists.requirementIds.has(requirementId)) {
        return {
          status: 'rejected',
          reason: 'unknown_requirement_id',
          detail: `requirementId "${requirementId}" was not offered in this request`,
        };
      }
    }
  }

  return { status: 'ok', findings: plan.findings };
}
