import { z } from 'zod';
import { uuidSchema } from './common';
import { resumeEntryIdSchema } from './resume-content';

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

const reasonSchema = z.string().trim().min(1).max(REASON_MAX);
/** Request-local requirement ids (§17) are never assumed to be UUIDs — a mapping-absent
 * fallback synthesizes plain string ids (`resume-tailoring-context.ts`), so this is deliberately
 * as permissive in shape as `resumeEntryIdSchema`. */
const requirementIdSchema = z.string().min(1).max(100);

export const resumeTailoringOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REWRITE_BULLET'),
    bulletId: resumeEntryIdSchema,
    proposedText: z.string().trim().min(1).max(OPERATION_TEXT_MAX),
    sourceFactIds: z.array(uuidSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
    requirementIds: z.array(requirementIdSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
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
     * "added anyway" (§10: "No fact IDs: reject"). */
    sourceFactIds: z.array(uuidSchema).min(1).max(MAX_CITATIONS_PER_OPERATION),
    requirementIds: z.array(requirementIdSchema).max(MAX_CITATIONS_PER_OPERATION).default([]),
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('OMIT_BULLET'),
    bulletId: resumeEntryIdSchema,
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('OMIT_ENTRY'),
    entryId: resumeEntryIdSchema,
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
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('MOVE_ENTRY'),
    entryId: resumeEntryIdSchema,
    /** 0-based position within the entry's own existing section array (education/experience/
     * projects/leadership) — entries never move across sections. */
    targetIndex: z.number().int().min(0),
    reason: reasonSchema,
  }),
  z.object({
    type: z.literal('REORDER_SKILLS'),
    /** Every existing skill-group id, in the new order — §13: no ADD_SKILL exists at all, this
     * only ever reorders groups that already exist in the base résumé. */
    orderedSkillGroupIds: z.array(resumeEntryIdSchema).min(1),
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

/**
 * One validated operation, enriched with server-resolved human-readable context for the UI
 * (§28/§29) — raw ids are kept out of normal display; before/after/labels are always resolved
 * from the actual base résumé and the actual request-local allowlists, never echoed from the
 * model's own claims about them.
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
    reason: z.string(),
  }),
  z.object({
    type: z.literal('ADD_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    after: z.string(),
    groundedFacts: z.array(z.object({ id: uuidSchema, label: z.string() })),
    relevantRequirements: z.array(z.object({ id: requirementIdSchema, text: z.string() })),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('OMIT_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    omittedText: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('OMIT_ENTRY'),
    entryId: resumeEntryIdSchema,
    entryLabel: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('MOVE_BULLET'),
    bulletId: resumeEntryIdSchema,
    entryLabel: z.string(),
    movedText: z.string(),
    fromIndex: z.number().int(),
    toIndex: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('MOVE_ENTRY'),
    entryId: resumeEntryIdSchema,
    entryLabel: z.string(),
    fromIndex: z.number().int(),
    toIndex: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('REORDER_SKILLS'),
    before: z.array(z.string()),
    after: z.array(z.string()),
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
  /** True when the base version has an active custom LaTeX override (Phase 7C/7D) — the
   * proposal is still generated from structured content only and never touches that override
   * (§22). Purely informational for the UI's warning banner. */
  customLatexOverridePresent: z.boolean(),
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
