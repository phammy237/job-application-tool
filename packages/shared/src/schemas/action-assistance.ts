import { z } from 'zod';
import { uuidSchema } from './common';
import type { NextActionType } from './next-action';

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
});
export type InterviewPrepRolePriority = z.infer<typeof interviewPrepRolePrioritySchema>;

export const interviewPrepEvidenceSchema = z.object({
  theme: z.string().trim().min(1).max(200),
  sourceFactIds: z.array(uuidSchema).max(10),
  summary: z.string().trim().min(1).max(500),
});
export type InterviewPrepEvidence = z.infer<typeof interviewPrepEvidenceSchema>;

export const interviewPrepStarStorySchema = z.object({
  competency: z.string().trim().min(1).max(200),
  sourceFactIds: z.array(uuidSchema).max(10),
  prompt: z.string().trim().min(1).max(500),
});
export type InterviewPrepStarStory = z.infer<typeof interviewPrepStarStorySchema>;

/** Never "the recruiter will ask this" — see this field's system-prompt instruction. `rationale`
 * exists precisely so the UI can render "Likely area to prepare based on the role requirements"
 * rather than a claim about what an actual interviewer will do. */
export const interviewPrepPossibleQuestionSchema = z.object({
  question: z.string().trim().min(1).max(400),
  rationale: z.string().trim().min(1).max(400),
  sourceRequirementIds: z.array(uuidSchema).max(10),
});
export type InterviewPrepPossibleQuestion = z.infer<
  typeof interviewPrepPossibleQuestionSchema
>;

export const interviewPrepQuestionToAskSchema = z.object({
  question: z.string().trim().min(1).max(400),
  rationale: z.string().trim().min(1).max(400),
});
export type InterviewPrepQuestionToAsk = z.infer<typeof interviewPrepQuestionToAskSchema>;

export const interviewPrepGapSchema = z.object({
  requirement: z.string().trim().min(1).max(400),
  sourceRequirementId: uuidSchema.nullable(),
  note: z.string().trim().min(1).max(400),
});
export type InterviewPrepGap = z.infer<typeof interviewPrepGapSchema>;

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

/** The full result returned to the client: the validated model contract, plus server-assembled
 * (never model-generated) frozen-answer context and a short human-readable provenance summary
 * (e.g. "Based on 6 job requirements and 8 approved profile facts"). */
export const interviewPrepResultSchema = interviewPrepModelContractSchema.extend({
  submittedAnswersToReview: z.array(interviewPrepSubmittedAnswerSchema).max(20),
  provenanceSummary: z.string(),
  usedCurrentRequirementMapping: z.boolean(),
});
export type InterviewPrepResult = z.infer<typeof interviewPrepResultSchema>;
