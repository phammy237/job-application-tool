import { z } from 'zod';
import { uuidSchema } from './common';
import {
  companyResearchFindingCategorySchema,
  companyResearchRequirementIdSchema,
  MAX_COMPANY_RESEARCH_FINDINGS,
} from './company-research';

/**
 * Phase 7G's model-facing raw output contract — deliberately separate from
 * `company-research.ts`'s persisted/read shape, same split 7E uses between
 * `resumeTailoringOperationSchema` (model-facing) and the resolved operation *view*. The model
 * never sees or produces a URL, a title, a publisher, or a publication date — it only cites
 * `sourceId`s from a fixed, request-local allowlist of sources Career OS already discovered and
 * extracted itself (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §16/§25: "The model should not invent
 * URLs" — structurally impossible here, since there is no field for one).
 */

const CLAIM_MAX = 500;
const ROLE_RELEVANCE_MAX = 400;
const MAX_SOURCE_IDS_PER_FINDING = 6;
const MAX_REQUIREMENT_IDS_PER_FINDING = 6;

export const companyResearchFindingContractSchema = z.object({
  category: companyResearchFindingCategorySchema,
  claim: z.string().trim().min(1).max(CLAIM_MAX),
  roleRelevance: z.string().trim().max(ROLE_RELEVANCE_MAX).nullable().default(null),
  /** Required non-empty — a finding with no cited source is rejected outright, never "added
   * anyway" (§13, same posture as 7E's ADD_BULLET requiring sourceFactIds). */
  sourceIds: z.array(uuidSchema).min(1).max(MAX_SOURCE_IDS_PER_FINDING),
  requirementIds: z
    .array(companyResearchRequirementIdSchema)
    .max(MAX_REQUIREMENT_IDS_PER_FINDING)
    .default([]),
});
export type CompanyResearchFindingContract = z.infer<
  typeof companyResearchFindingContractSchema
>;

/** The model's entire raw-response contract — nothing else. No executive summary field: the
 * summary shown to the user is derived deterministically from validated findings
 * (`build-company-research-summary.ts`), never a separate free-text field the model could fill
 * with a claim no finding actually supports (§50). */
export const companyResearchPlanContractSchema = z.object({
  findings: z
    .array(companyResearchFindingContractSchema)
    .max(MAX_COMPANY_RESEARCH_FINDINGS),
});
export type CompanyResearchPlanContract = z.infer<
  typeof companyResearchPlanContractSchema
>;
