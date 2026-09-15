import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * Phase 7G — company research intelligence foundation (docs/IMPLEMENTATION_PLAN.md "Phase 7G").
 * Research is explicit, application-contextual, and RESEARCH ONLY: it never touches a résumé, a
 * résumé version, `working_resume_version_id`, or interview prep (that intersection is Phase
 * 7H/7I). This file is the persisted/read shape of a completed research snapshot — see
 * `company-research-contract.ts` for the separate, narrower, model-facing raw output contract.
 *
 * Deliberately no `companies` table (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §4): a snapshot
 * freezes `companyName`/`roleTitle` as plain text at research time, so historical research stays
 * understandable even if the application's own company/title fields are later edited or the
 * application itself is deleted (§7 below).
 */

export const companyResearchSourceTypeSchema = z.enum([
  'OFFICIAL_WEBSITE',
  'OFFICIAL_NEWSROOM',
  'INVESTOR_RELATIONS',
  'ENGINEERING_BLOG',
  'PRODUCT_BLOG',
  'CAREERS',
  'REPUTABLE_NEWS',
  'OTHER',
]);
export type CompanyResearchSourceType = z.infer<typeof companyResearchSourceTypeSchema>;

export const companyResearchFindingCategorySchema = z.enum([
  'PRODUCT',
  'STRATEGY',
  'TECHNOLOGY',
  'BUSINESS',
  'CULTURE',
  'HIRING',
  'RECENT_DEVELOPMENT',
  'OTHER',
]);
export type CompanyResearchFindingCategory = z.infer<
  typeof companyResearchFindingCategorySchema
>;

const SOURCE_URL_MAX = 2000;
const SOURCE_TITLE_MAX = 300;
const SOURCE_PUBLISHER_MAX = 200;
/** §11 — bounded evidence excerpt, never a full article. 1500 is the top of the task's own
 * suggested 500–1500 character range. */
export const EVIDENCE_EXCERPT_MAX = 1500;
const CLAIM_MAX = 500;
const ROLE_RELEVANCE_MAX = 400;
const REQUIREMENT_ID_MAX = 100;
/** §26 — bounds worst-case findings per snapshot; also enforced as an insert-time DB check. */
export const MAX_COMPANY_RESEARCH_FINDINGS = 16;
const MAX_REQUIREMENT_IDS_PER_FINDING = 6;
const MAX_SOURCE_IDS_PER_FINDING = 6;

/** A stable, request-local requirement id — same deliberately permissive shape as 7E's
 * `requirementIdSchema` (`resume-tailoring.ts`): sometimes a real `requirement_evidence_mappings.
 * id` (a uuid), sometimes a synthesized per-request id (`required-0`, …) when no mapping exists
 * yet (§15/§43). Never assumed to be a uuid. */
export const companyResearchRequirementIdSchema = z
  .string()
  .min(1)
  .max(REQUIREMENT_ID_MAX);

export const companyResearchSourceSchema = z.object({
  id: uuidSchema,
  url: z.string().url().max(SOURCE_URL_MAX),
  canonicalUrl: z.string().url().max(SOURCE_URL_MAX).nullable(),
  title: z.string().trim().min(1).max(SOURCE_TITLE_MAX),
  publisher: z.string().max(SOURCE_PUBLISHER_MAX).nullable(),
  sourceType: companyResearchSourceTypeSchema,
  /** Null when the source itself doesn't expose a real publication date — never manufactured
   * (§28: "If unknown: do not manufacture a date"). */
  publishedAt: isoDateTimeSchema.nullable(),
  retrievedAt: isoDateTimeSchema,
  evidenceExcerpt: z.string().max(EVIDENCE_EXCERPT_MAX).nullable(),
  contentHash: z.string().max(128).nullable(),
});
export type CompanyResearchSource = z.infer<typeof companyResearchSourceSchema>;

export const companyResearchFindingSchema = z.object({
  id: uuidSchema,
  category: companyResearchFindingCategorySchema,
  claim: z.string().trim().min(1).max(CLAIM_MAX),
  /** Deliberately separate from `claim` (§14): a factual company claim vs. why it matters for
   * *this* role. Null when the model had nothing role-specific to say about this particular
   * finding — never fabricated to fill the field. */
  roleRelevance: z.string().max(ROLE_RELEVANCE_MAX).nullable(),
  requirementIds: z
    .array(companyResearchRequirementIdSchema)
    .max(MAX_REQUIREMENT_IDS_PER_FINDING)
    .default([]),
  /** Every finding must cite at least one source — no uncited factual claims (§13). Resolved,
   * ordered source objects (not bare ids) so the UI never has to re-look-up a citation. */
  sources: z.array(companyResearchSourceSchema).min(1).max(MAX_SOURCE_IDS_PER_FINDING),
});
export type CompanyResearchFinding = z.infer<typeof companyResearchFindingSchema>;

/** The full, read-only, immutable research snapshot (§6/§8) — everything needed to render one
 * complete report, already resolved (sources embedded in findings, never raw ids the UI has to
 * chase). */
export const companyResearchSnapshotSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema.nullable(),
  companyName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(200),
  jobSnapshotId: uuidSchema.nullable(),
  researchedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  findings: z.array(companyResearchFindingSchema).max(MAX_COMPANY_RESEARCH_FINDINGS),
  sources: z.array(companyResearchSourceSchema),
});
export type CompanyResearchSnapshot = z.infer<typeof companyResearchSnapshotSchema>;

/** Lightweight summary for a snapshot-history list (§31/§52) — never re-fetches every finding/
 * source just to render "Sep 15 · 12 findings · 9 sources". */
export const companyResearchSnapshotSummarySchema = z.object({
  id: uuidSchema,
  companyName: z.string(),
  roleTitle: z.string(),
  researchedAt: isoDateTimeSchema,
  findingCount: z.number().int().min(0),
  sourceCount: z.number().int().min(0),
});
export type CompanyResearchSnapshotSummary = z.infer<
  typeof companyResearchSnapshotSummarySchema
>;
