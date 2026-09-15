import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { resumeEntryIdSchema, structuredResumeV1Schema } from './resume-content';

/**
 * Phase 7E — grounded, job-specific résumé tailoring. The model NEVER returns a résumé, LaTeX,
 * or a JSON Patch — only a small, closed set of semantic operations against stable ids already
 * present in the base résumé (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §2/§8). Every operation
 * references a bullet/entry purely by its existing stable id; the server (never the model)
 * resolves which section array it lives in, its current text, and its current position —
 * removing an entire class of "the model lied about where this is" attack surface by
 * construction, not by a check.
 *
 * Immutable-by-construction (§14): no operation type can rename an organization/role/school/
 * degree, change a date, change a location, change project identity, or change contact info —
 * the schema below simply has no field for any of that. The only way to change those is the
 * existing manual Resume Studio flow (Phase 7C/7D), which creates a new version.
 */

export const MAX_RESUME_TAILORING_OPERATIONS = 30;
const OPERATION_TEXT_MAX = 600; // matches resumeBulletSchema's own bullet-text cap
const REASON_MAX = 300;
const MAX_CITATIONS_PER_OPERATION = 12;
/** Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §12) — deliberately smaller than
 * MAX_CITATIONS_PER_OPERATION: a research finding never grounds a claim, it only explains why
 * emphasizing existing, already-grounded content is strategically relevant for this company, so a
 * handful is always enough. */
const MAX_RESEARCH_FINDINGS_PER_OPERATION = 4;

const reasonSchema = z.string().trim().min(1).max(REASON_MAX);
/** Request-local requirement ids (§17) are never assumed to be UUIDs — a mapping-absent
 * fallback synthesizes plain string ids (`resume-tailoring-context.ts`), so this is deliberately
 * as permissive in shape as `resumeEntryIdSchema`. */
const requirementIdSchema = z.string().min(1).max(100);
/** Request-local company-research finding ids offered for THIS tailoring request — always a real
 * `company_research_findings.id` (uuid), scoped to the one snapshot resolved for this request
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §6/§14). */
const researchFindingIdSchema = uuidSchema;
/** OPTIONAL on every operation type (§12/§20/§21) — never required, and never a substitute for
 * `sourceFactIds`/`requirementIds`: it explains COMPANY RELEVANCE, a third, separate provenance
 * bucket from factual grounding and role grounding (§13), never merged with either. */
const researchFindingIdsSchema = z
  .array(researchFindingIdSchema)
  .max(MAX_RESEARCH_FINDINGS_PER_OPERATION)
  .default([]);

/**
 * Phase 7H — explicit, user-chosen tailoring mode (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §4/
 * §36/§37). `JOB_ONLY` is exactly Phase 7E/7F's existing behavior, unchanged. Company research is
 * never required and never silently assumed just because a snapshot exists for this application.
 */
export const resumeTailoringResearchModeSchema = z.enum([
  'JOB_ONLY',
  'JOB_PLUS_COMPANY_RESEARCH',
]);
export type ResumeTailoringResearchMode = z.infer<
  typeof resumeTailoringResearchModeSchema
>;

/**
 * POST /api/applications/:id/resume-tailoring request body (Phase 7H §37) — deliberately the
 * ONLY two fields this route accepts; every other input (which application, which working
 * résumé, which job snapshot) is still always re-derived server-side, never client-supplied
 * (§3/§40, unchanged from 7E). An empty/absent body parses to `{researchMode: 'JOB_ONLY'}` —
 * exactly Phase 7E/7F's original, unchanged behavior — so no existing call site breaks.
 */
export const generateResumeTailoringRequestSchema = z.object({
  researchMode: resumeTailoringResearchModeSchema.default('JOB_ONLY'),
  /** Ignored entirely when researchMode is JOB_ONLY (§37) — never trusted blindly either way; the
   * pipeline re-resolves ownership/compatibility server-side before ever using it (§6/§7). */
  companyResearchSnapshotId: uuidSchema.nullable().optional(),
});
export type GenerateResumeTailoringRequest = z.infer<
  typeof generateResumeTailoringRequestSchema
>;

export const resumeTailoringOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REWRITE_BULLET'),
    bulletId: resumeEntryIdSchema,
    proposedText: z.string().trim().min(1).max(OPERATION_TEXT_MAX),
    sourceFactIds: z.array(uuidSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
    requirementIds: z.array(requirementIdSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
    /** Phase 7H (§12/§19) — company research may explain why this rewrite's *emphasis* is
     * strategically relevant; it never grounds the rewrite's factual content. */
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('ADD_BULLET'),
    /** The existing entry (education/experience/project/leadership) to add this bullet to —
     * the server resolves which section it belongs to; the model never states a section
     * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §10). */
    entryId: resumeEntryIdSchema,
    proposedText: z.string().trim().min(1).max(OPERATION_TEXT_MAX),
    /** Required non-empty — an added bullet with no cited evidence is rejected outright, never
     * "added anyway" (§10: "No fact IDs: reject"). Phase 7H §18: `researchFindingIds` can never
     * substitute for this — a research finding alone is never enough to add a bullet. */
    sourceFactIds: z.array(uuidSchema).min(1).max(MAX_CITATIONS_PER_OPERATION),
    requirementIds: z.array(requirementIdSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('OMIT_BULLET'),
    bulletId: resumeEntryIdSchema,
    /** Phase 7H §20 — omission is one of the operations research is *particularly* appropriate
     * for: it changes emphasis without creating any new claim. */
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('OMIT_ENTRY'),
    entryId: resumeEntryIdSchema,
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('MOVE_BULLET'),
    bulletId: resumeEntryIdSchema,
    /** 0-based position within the bullet's own existing parent entry — bullets never move
     * across entries (§12: "Choose a deterministic representation... do not choose a brittle
     * design"). Bounds are re-validated against the actual array length server-side; the model
     * cannot see the array length ahead of time so an out-of-range value is expected and simply
     * rejected, never clamped. */
    targetIndex: z.number().int().min(0),
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('MOVE_ENTRY'),
    entryId: resumeEntryIdSchema,
    /** 0-based position within the entry's own existing section array (education/experience/
     * projects/leadership) — entries never move across sections. */
    targetIndex: z.number().int().min(0),
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('REORDER_SKILLS'),
    /** Every existing skill-group id, in the new order — §13: no ADD_SKILL exists at all, this
     * only ever reorders groups that already exist in the base résumé. */
    orderedSkillGroupIds: z.array(resumeEntryIdSchema).min(1),
    researchFindingIds: researchFindingIdsSchema,
    reason: reasonSchema,
  }),
]);
export type ResumeTailoringOperation = z.infer<typeof resumeTailoringOperationSchema>;
export type ResumeTailoringOperationType = ResumeTailoringOperation['type'];

/** The model's entire raw-response contract — nothing else. No `latexSource`, no `template`,
 * no free-form résumé field anywhere in this schema (§23/§44). */
export const resumeTailoringPlanSchema = z.object({
  operations: z.array(resumeTailoringOperationSchema).max(MAX_RESUME_TAILORING_OPERATIONS),
});
export type ResumeTailoringPlan = z.infer<typeof resumeTailoringPlanSchema>;

/** Which of the four résumé sections an entry id was found in — resolved by the server from the
 * base résumé, never supplied by the model (see the module doc comment above). */
export const resumeSectionNameSchema = z.enum([
  'education',
  'experience',
  'projects',
  'leadership',
]);
export type ResumeSectionName = z.infer<typeof resumeSectionNameSchema>;

/** One company-research finding resolved for display (§32) — human-readable, never a raw uuid
 * exposed to the UI on its own. `category` is kept as a plain string (not the finding-category
 * enum) so this file doesn't need a dependency on `company-research.ts` for what is, here, purely
 * a display label. */
export const resumeTailoringCompanyRelevanceItemSchema = z.object({
  id: researchFindingIdSchema,
  claim: z.string(),
  roleRelevance: z.string().nullable(),
  category: z.string(),
});
export type ResumeTailoringCompanyRelevanceItem = z.infer<
  typeof resumeTailoringCompanyRelevanceItemSchema
>;
const companyRelevanceSchema = z.array(resumeTailoringCompanyRelevanceItemSchema).default([]);

/**
 * One validated operation, enriched with server-resolved human-readable context for the UI
 * (§28/§29) — raw ids are kept out of normal display; before/after/labels are always resolved
 * from the actual base résumé and the actual request-local allowlists, never echoed from the
 * model's own claims about them. `companyRelevance` (Phase 7H §32) is a strictly separate, third
 * provenance bucket from `groundedFacts`/`relevantRequirements` — it explains why this change
 * matters for *this company*, never why it's *true* of the candidate.
 */
export const resumeTailoringOperationViewSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REWRITE_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    before: z.string(),
    after: z.string(),
    groundedFacts: z.array(z.object({ id: uuidSchema, label: z.string() })),
    relevantRequirements: z.array(z.object({ id: requirementIdSchema, text: z.string() })),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('ADD_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    after: z.string(),
    groundedFacts: z.array(z.object({ id: uuidSchema, label: z.string() })),
    relevantRequirements: z.array(z.object({ id: requirementIdSchema, text: z.string() })),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('OMIT_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    omittedText: z.string(),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('OMIT_ENTRY'),
    entryId: resumeEntryIdSchema,
    entryLabel: z.string(),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('MOVE_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    movedText: z.string(),
    fromIndex: z.number().int(),
    toIndex: z.number().int(),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('MOVE_ENTRY'),
    entryId: resumeEntryIdSchema,
    entryLabel: z.string(),
    fromIndex: z.number().int(),
    toIndex: z.number().int(),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('REORDER_SKILLS'),
    before: z.array(z.string()),
    after: z.array(z.string()),
    /** The same ids `after`'s labels were resolved from, in the same order — kept alongside the
     * human-readable labels (not in place of them) so Phase 7F's review/save path has a stable,
     * unambiguous way to re-apply this operation without guessing an id back from a label that
     * might not be unique (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §11/§48). */
    orderedSkillGroupIds: z.array(resumeEntryIdSchema),
    companyRelevance: companyRelevanceSchema,
    reason: z.string(),
  }),
]);
export type ResumeTailoringOperationView = z.infer<typeof resumeTailoringOperationViewSchema>;

/** Server-computed, never trusted from the model (§27) — counted directly from the validated
 * operation list after every guard has already passed. */
export const resumeTailoringSummarySchema = z.object({
  rewrittenBullets: z.number().int().min(0),
  addedBullets: z.number().int().min(0),
  omittedBullets: z.number().int().min(0),
  omittedEntries: z.number().int().min(0),
  movedBullets: z.number().int().min(0),
  movedEntries: z.number().int().min(0),
  skillsReordered: z.boolean(),
  requirementsReferenced: z.number().int().min(0),
  /** Phase 7H §31 — distinct company-research finding ids cited by any operation in this plan.
   * Always 0 when `researchMode` is `JOB_ONLY` (there is nothing to cite). Server-computed, never
   * trusted from the model, same posture as every other summary field here. */
  researchFindingsReferenced: z.number().int().min(0),
  /** Count of operations whose `researchFindingIds` is non-empty — a separate, coarser signal
   * from `researchFindingsReferenced` (one operation may cite several findings). */
  operationsInfluencedByResearch: z.number().int().min(0),
});
export type ResumeTailoringSummary = z.infer<typeof resumeTailoringSummarySchema>;

/**
 * Factual requirement coverage (§25/§26) — never an "ATS score" or any other single aggregate
 * number. `coveredRequirementIds` and `unsupportedRequirementIds` partition the full requirement
 * list offered for this request (every id is in exactly one of the two, or neither if it was
 * simply never addressed); `referencedRequirementIds` is the (usually smaller) subset actually
 * cited by a *validated* operation in this specific plan.
 */
export const resumeTailoringCoverageSchema = z.object({
  totalRequirementCount: z.number().int().min(0),
  coveredRequirementIds: z.array(requirementIdSchema),
  unsupportedRequirementIds: z.array(requirementIdSchema),
  referencedRequirementIds: z.array(requirementIdSchema),
  /** Human-readable text for every unsupported requirement, resolved server-side, for the "no
   * grounded evidence found" UI (§26) — never silently dropped in favor of raw ids. */
  unsupportedRequirements: z.array(z.object({ id: requirementIdSchema, text: z.string() })),
});
export type ResumeTailoringCoverage = z.infer<typeof resumeTailoringCoverageSchema>;

/**
 * The full read-only proposal response (§37) — ephemeral, never persisted
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §21/§45). `baseResumeVersionId` is always the
 * server-re-derived working version actually used for this generation (§3/§40), regardless of
 * what (if anything) the client believed it was when the request was sent.
 */
export const resumeTailoringProposalSchema = z.object({
  baseResumeVersionId: uuidSchema,
  baseResumeDisplayName: z.string(),
  baseResumeVersionNumber: z.number().int().positive(),
  /** The job snapshot this proposal was generated against — server-derived from the
   * application's job snapshot at generation time, never client-supplied (Phase 7F §15/§58). A
   * later save re-derives the application's *current* job snapshot id and rejects with
   * `stale_job_context` if it no longer matches this value, the same way `baseResumeVersionId`
   * guards against a working-résumé change mid-review. */
  jobSnapshotId: uuidSchema,
  /** The CURRENT requirement-mapping run reused for this proposal, if one existed — purely
   * informational (never itself re-checked at save time; job-snapshot identity is the save-time
   * staleness signal, docs/IMPLEMENTATION_PLAN.md "Phase 7F" §15). */
  requirementMappingRunId: uuidSchema.nullable(),
  /** The exact base résumé content operations above were computed against (Phase 7F §12/§24) —
   * the same `StructuredResumeV1` the Studio already renders/edits, not a new representation.
   * Included so the review UI can build a live, fully client-side preview of the reviewed draft
   * on every accept/reject/edit (§46) without a server round trip per click; it is never treated
   * as writable on its own — only `save_reviewed_tailored_resume` can persist anything, and only
   * after independently re-deriving and re-validating this same content server-side (§13/§48). */
  baseResume: structuredResumeV1Schema,
  /** True when the base version has an active custom LaTeX override (Phase 7C/7D) — the
   * proposal is still generated from structured content only and never touches that override
   * (§22). Purely informational for the UI's warning banner. */
  customLatexOverridePresent: z.boolean(),
  /** Phase 7H (§3/§4/§34/§38) — the ACTUAL mode this proposal was generated with, which may
   * differ from what the caller requested: requesting `JOB_PLUS_COMPANY_RESEARCH` with no
   * eligible snapshot for this application degrades honestly to `JOB_ONLY` rather than erroring
   * (§4), and the response always reflects what actually happened, never what was asked for. */
  researchMode: resumeTailoringResearchModeSchema,
  /** The exact immutable snapshot actually used, or null when `researchMode` is `JOB_ONLY` (§3) —
   * never the "latest" snapshot re-resolved implicitly; a later save persists this exact id
   * alongside the résumé version it produces (Phase 7H §41), so this is the one durable identity
   * this proposal's UI/save flow needs, never the whole snapshot. */
  companyResearchSnapshotId: uuidSchema.nullable(),
  /** The snapshot's own frozen `researchedAt` (§34: "Company research: Sep 15, 2026") — purely
   * informational, resolved once here so the UI never has to re-fetch the snapshot just to show
   * its date. Null exactly when `companyResearchSnapshotId` is null. */
  companyResearchResearchedAt: isoDateTimeSchema.nullable(),
  /** How many of the snapshot's findings were actually selected into this request's prompt
   * (§22/§34) — bounded by RESEARCH_TAILORING_MAX_FINDINGS (packages/ai/src/config.ts), never the
   * snapshot's full finding count. 0 when `researchMode` is `JOB_ONLY`. */
  selectedResearchFindingCount: z.number().int().min(0),
  operations: z.array(resumeTailoringOperationViewSchema),
  summary: resumeTailoringSummarySchema,
  coverage: resumeTailoringCoverageSchema,
  /**
   * LaTeX for the *proposed* structured content, rendered by the same deterministic
   * `renderStructuredResumeToLatex` the Studio uses for structured content (§22) — never
   * generated or touched by the model. Deliberately never `getLatexForResumeVersion`: when
   * `customLatexOverridePresent` is true, this is still the structured-content render, not the
   * base version's actual override (which would silently discard every proposed edit) — the UI
   * surfaces the warning banner precisely because this preview will not match what the base
   * version currently renders as.
   */
  proposedResumeLatex: z.string(),
});
export type ResumeTailoringProposal = z.infer<typeof resumeTailoringProposalSchema>;
