import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import type { NextActionType } from './next-action';
import { companyResearchModeSchema, companyResearchRelevanceItemSchema } from './resume-tailoring';

/**
 * Phase 5C.3 — the AI-assistance layer's own domain concept, deliberately separate from
 * `NextActionType` (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3C"). `NextActionType` is the
 * deterministic engine's decision about *what to do next*; `ActionAssistanceType` is *whether
 * Career OS can help the user do it*, and only exists for the handful of next actions where a
 * grounded AI draft is actually useful — not one value per `NextActionType` (that would just
 * make the enum symmetrical, not useful; explicitly out of scope per the phase brief).
 */
export const actionAssistanceTypeSchema = z.enum(['FOLLOW_UP_DRAFT', 'INTERVIEW_PREP']);
export type ActionAssistanceType = z.infer<typeof actionAssistanceTypeSchema>;

/**
 * The single source of truth for "which next action, if any, has an AI-assistance feature" —
 * reused by both API routes (server-side eligibility gate) and their tests, so this mapping is
 * defined in exactly one place and can never drift between a route and its own test's
 * expectations. Deliberately a plain function over a lookup table some caller could mutate.
 */
export function actionAssistanceFor(
  nextActionType: NextActionType,
): ActionAssistanceType | null {
  switch (nextActionType) {
    case 'CONSIDER_FOLLOW_UP':
      return 'FOLLOW_UP_DRAFT';
    case 'PREPARE_INTERVIEW':
      return 'INTERVIEW_PREP';
    default:
      return null;
  }
}

// ================================================================================================
// Follow-up drafting (5C.3A)
// ================================================================================================

/**
 * What the model is actually asked to produce — deliberately just `subject`/`body`, NOT the
 * `groundingNotes`/`usedContext` the phase brief's illustrative schema suggested. A model-written
 * "grounding note" is free text and could itself fabricate a source ("grounded in your call with
 * the recruiter") — exactly the class of invented-interaction risk 5C.3M exists to prevent. This
 * repo's established grounding pattern is that provenance is always server-derived, never
 * model-generated (see `matchedFactProvenanceSchema`'s own doc comment) — `usedContext` below is
 * computed by `generate-follow-up-draft.ts` from what was *actually* retrieved, never echoed back
 * from the model's own claim about what it used.
 */
export const followUpDraftModelContractSchema = z.object({
  subject: z.string().trim().min(1).max(200).nullable(),
  body: z.string().trim().min(1).max(4000),
});
export type FollowUpDraftModelContract = z.infer<typeof followUpDraftModelContractSchema>;

/** Server-derived provenance tags for the follow-up draft — one entry per trusted input that was
 * actually placed in the prompt, never a model claim. Deliberately a closed, small enum (not free
 * text) so the UI's "based on ..." line can never itself become a hallucination surface. */
export const followUpDraftUsedContextTagSchema = z.enum([
  'APPLICATION_STATUS',
  'APPLICATION_DATE',
  'FOLLOW_UP_TIMING',
  'JOB_SNAPSHOT',
  'CONFIRMED_EMPLOYER_EMAIL',
  'CANDIDATE_NAME',
]);
export type FollowUpDraftUsedContextTag = z.infer<
  typeof followUpDraftUsedContextTagSchema
>;

export const followUpDraftResultSchema = followUpDraftModelContractSchema.extend({
  usedContext: z.array(followUpDraftUsedContextTagSchema),
});
export type FollowUpDraftResult = z.infer<typeof followUpDraftResultSchema>;

// ================================================================================================
// Interview preparation (5C.3B)
// ================================================================================================

/** Phase 7I (docs/IMPLEMENTATION_PLAN.md "Phase 7I" §"researchFindingIds provenance pattern") —
 * deliberately small: a research finding never grounds a claim, it only explains why a candidate-
 * or role-relevant item is strategically relevant for this company right now, so a handful is
 * always enough. Same cap as Phase 7H's per-operation `MAX_RESEARCH_FINDINGS_PER_OPERATION`. */
const MAX_RESEARCH_FINDINGS_PER_ITEM = 4;
/** OPTIONAL on every interview-prep item type — never required, and never a substitute for
 * `sourceFactIds`/`sourceRequirementId(s)`: it is a THIRD, independent provenance bucket (company
 * relevance), never merged with factual or role grounding. */
const researchFindingIdsSchema = z
  .array(uuidSchema)
  .max(MAX_RESEARCH_FINDINGS_PER_ITEM)
  .default([]);
/** Resolved, human-readable company-relevance context for the final result (never raw ids) —
 * same shape Phase 7H already established for résumé tailoring, reused under a neutral name (see
 * `resume-tailoring.ts`'s `companyResearchRelevanceItemSchema`). */
const companyRelevanceSchema = z.array(companyResearchRelevanceItemSchema).default([]);

/**
 * `sourceRequirementId` is nullable throughout: when no CURRENT requirement-mapping run exists
 * for the job snapshot, this pipeline degrades to reading the snapshot's own requirement lists
 * directly (never silently triggering Phase 5A's mapping generation — 5C.3B's explicit
 * instruction), and there is then no persisted `requirement_evidence_mappings` id to cite at all.
 * Every non-null id here and every `sourceFactIds` entry below is validated server-side against
 * the exact ids actually placed in the prompt (packages/ai's
 * `validate-interview-prep-contract.ts`) — the model can never cite an id it wasn't given.
 */
export const interviewPrepRolePrioritySchema = z.object({
  requirement: z.string().trim().min(1).max(400),
  importance: z.enum(['REQUIRED', 'PREFERRED']),
  sourceRequirementId: uuidSchema.nullable(),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepRolePriority = z.infer<typeof interviewPrepRolePrioritySchema>;
export const interviewPrepRolePriorityViewSchema = interviewPrepRolePrioritySchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepRolePriorityView = z.infer<typeof interviewPrepRolePriorityViewSchema>;

export const interviewPrepEvidenceSchema = z.object({
  theme: z.string().trim().min(1).max(200),
  sourceFactIds: z.array(uuidSchema).max(10),
  summary: z.string().trim().min(1).max(500),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepEvidence = z.infer<typeof interviewPrepEvidenceSchema>;
export const interviewPrepEvidenceViewSchema = interviewPrepEvidenceSchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepEvidenceView = z.infer<typeof interviewPrepEvidenceViewSchema>;

export const interviewPrepStarStorySchema = z.object({
  competency: z.string().trim().min(1).max(200),
  sourceFactIds: z.array(uuidSchema).max(10),
  prompt: z.string().trim().min(1).max(500),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepStarStory = z.infer<typeof interviewPrepStarStorySchema>;
export const interviewPrepStarStoryViewSchema = interviewPrepStarStorySchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepStarStoryView = z.infer<typeof interviewPrepStarStoryViewSchema>;

/** Never "the recruiter will ask this" — see this field's system-prompt instruction. `rationale`
 * exists precisely so the UI can render "Likely area to prepare based on the role requirements"
 * rather than a claim about what an actual interviewer will do. */
export const interviewPrepPossibleQuestionSchema = z.object({
  question: z.string().trim().min(1).max(400),
  rationale: z.string().trim().min(1).max(400),
  sourceRequirementIds: z.array(uuidSchema).max(10),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepPossibleQuestion = z.infer<
  typeof interviewPrepPossibleQuestionSchema
>;
export const interviewPrepPossibleQuestionViewSchema = interviewPrepPossibleQuestionSchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepPossibleQuestionView = z.infer<
  typeof interviewPrepPossibleQuestionViewSchema
>;

export const interviewPrepQuestionToAskSchema = z.object({
  question: z.string().trim().min(1).max(400),
  rationale: z.string().trim().min(1).max(400),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepQuestionToAsk = z.infer<typeof interviewPrepQuestionToAskSchema>;
export const interviewPrepQuestionToAskViewSchema = interviewPrepQuestionToAskSchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepQuestionToAskView = z.infer<
  typeof interviewPrepQuestionToAskViewSchema
>;

export const interviewPrepGapSchema = z.object({
  requirement: z.string().trim().min(1).max(400),
  sourceRequirementId: uuidSchema.nullable(),
  note: z.string().trim().min(1).max(400),
  researchFindingIds: researchFindingIdsSchema,
});
export type InterviewPrepGap = z.infer<typeof interviewPrepGapSchema>;
export const interviewPrepGapViewSchema = interviewPrepGapSchema
  .omit({ researchFindingIds: true })
  .extend({ companyRelevance: companyRelevanceSchema });
export type InterviewPrepGapView = z.infer<typeof interviewPrepGapViewSchema>;

/** The model's raw-response contract. Capped array lengths bound worst-case output size/cost and
 * keep the UI from ever needing to render an unbounded list. */
export const interviewPrepModelContractSchema = z.object({
  rolePriorities: z.array(interviewPrepRolePrioritySchema).max(12),
  evidenceToEmphasize: z.array(interviewPrepEvidenceSchema).max(8),
  starStoryPrompts: z.array(interviewPrepStarStorySchema).max(6),
  possibleQuestions: z.array(interviewPrepPossibleQuestionSchema).max(8),
  questionsToAsk: z.array(interviewPrepQuestionToAskSchema).max(6),
  gapsToPrepare: z.array(interviewPrepGapSchema).max(8),
});
export type InterviewPrepModelContract = z.infer<typeof interviewPrepModelContractSchema>;

/** One previously-submitted answer surfaced for consistency ("be prepared to discuss the answer
 * you gave about X") — read directly from the immutable `submission_packets` row, never
 * reconstructed or presented as current profile data. Server-assembled only; never model output. */
export const interviewPrepSubmittedAnswerSchema = z.object({
  fieldLabel: z.string(),
  answerText: z.string(),
});
export type InterviewPrepSubmittedAnswer = z.infer<
  typeof interviewPrepSubmittedAnswerSchema
>;

/** The full result returned to the client: the validated model contract (with every item's
 * `researchFindingIds` resolved into human-readable `companyRelevance`, never a raw id — Phase
 * 7I), plus server-assembled (never model-generated) frozen-answer context, a short human-
 * readable provenance summary, and (Phase 7I) server-computed company-research metadata. */
export const interviewPrepResultSchema = z.object({
  rolePriorities: z.array(interviewPrepRolePriorityViewSchema).max(12),
  evidenceToEmphasize: z.array(interviewPrepEvidenceViewSchema).max(8),
  starStoryPrompts: z.array(interviewPrepStarStoryViewSchema).max(6),
  possibleQuestions: z.array(interviewPrepPossibleQuestionViewSchema).max(8),
  questionsToAsk: z.array(interviewPrepQuestionToAskViewSchema).max(6),
  gapsToPrepare: z.array(interviewPrepGapViewSchema).max(8),
  submittedAnswersToReview: z.array(interviewPrepSubmittedAnswerSchema).max(20),
  provenanceSummary: z.string(),
  usedCurrentRequirementMapping: z.boolean(),
  /** Phase 7I — the ACTUAL mode this prep was generated with, which may differ from what the
   * caller requested: requesting `JOB_PLUS_COMPANY_RESEARCH` with no eligible snapshot for this
   * application degrades honestly to `JOB_ONLY` rather than erroring, and this always reflects
   * what actually happened. */
  researchMode: companyResearchModeSchema,
  /** The exact immutable snapshot actually used, or null when `researchMode` is `JOB_ONLY`.
   * Never the "latest" snapshot re-resolved implicitly. */
  companyResearchSnapshotId: uuidSchema.nullable(),
  /** The snapshot's own frozen `researchedAt` — resolved once here so the UI never has to
   * re-fetch the snapshot just to show its date. Null exactly when
   * `companyResearchSnapshotId` is null. */
  companyResearchResearchedAt: isoDateTimeSchema.nullable(),
  /** How many of the snapshot's findings were actually selected into this request's prompt —
   * bounded, never the snapshot's full finding count. 0 when `researchMode` is `JOB_ONLY`. */
  selectedResearchFindingCount: z.number().int().min(0),
  /** Distinct company-research finding ids actually cited by any item in this result — never
   * trusted from the model, always recomputed server-side after validation. */
  researchFindingsReferenced: z.number().int().min(0),
  /** Count of items (across every section) whose `researchFindingIds` was non-empty — a coarser,
   * separate signal from `researchFindingsReferenced` (one item may cite several findings). */
  itemsInfluencedByResearch: z.number().int().min(0),
});
export type InterviewPrepResult = z.infer<typeof interviewPrepResultSchema>;

/**
 * POST /api/applications/:id/interview-prep request body (Phase 7I, same shape/rationale as
 * résumé tailoring's `generateResumeTailoringRequestSchema`) — deliberately the ONLY two fields
 * this route accepts; every other input (which application, which job snapshot) is still always
 * re-derived server-side, never client-supplied. An empty/absent body parses to
 * `{researchMode: 'JOB_ONLY'}` — exactly Phase 5C.3B's original, unchanged behavior — so no
 * existing call site breaks.
 */
export const generateInterviewPrepRequestSchema = z.object({
  researchMode: companyResearchModeSchema.default('JOB_ONLY'),
  /** Ignored entirely when researchMode is JOB_ONLY — never trusted blindly either way; the
   * pipeline re-resolves ownership/compatibility server-side before ever using it. */
  companyResearchSnapshotId: uuidSchema.nullable().optional(),
});
export type GenerateInterviewPrepRequest = z.infer<typeof generateInterviewPrepRequestSchema>;
