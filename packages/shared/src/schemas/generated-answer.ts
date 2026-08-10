import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { fieldClassificationSchema } from './detected-field';

/**
 * The three ways a model response can fail the rejection gate (docs/AI_GROUNDING.md §4).
 * Shared between the persisted generated_answers row (rejectionReason below) and
 * packages/ai's contract validation (which re-exports this as its RejectionReason type) so
 * there is one source of truth for the enum's values.
 */
export const generatedAnswerRejectionReasonSchema = z.enum([
  'validation_failed',
  'unknown_source_fact_id',
  'unsupported_claims_present',
]);
export type GeneratedAnswerRejectionReason = z.infer<typeof generatedAnswerRejectionReasonSchema>;

/**
 * The model's raw-response contract, matching docs/AI_GROUNDING.md §3. This is what
 * packages/ai validates a model response against — it is not the persisted row shape (see
 * generatedAnswerSchema below), since the row carries FKs/audit fields the model never sees.
 *
 * sourceFactIds must be non-empty: there is no such thing as a zero-provenance approved
 * answer. reasoningSummary is user-facing prose, never raw chain-of-thought. unsupportedClaims
 * is the model's own self-report of anything in its draft it couldn't tie to a provided fact —
 * belt-and-suspenders alongside the independent sourceFactIds allowlist check in packages/ai.
 * insufficientData is a narrower self-report than unsupportedClaims: true means the provided
 * facts genuinely don't support this specific claim (a data gap), false means the model just
 * needs to try harder/format better (a model-quality issue) — see packages/ai's retryable.ts.
 * Like unsupportedClaims, this is a model self-report, not verified ground truth; it is used
 * only to route between the cheap and premium models, never as a correctness gate.
 */
export const generatedAnswerContractSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sourceFactIds: z.array(uuidSchema).min(1),
  reasoningSummary: z.string().max(400),
  unsupportedClaims: z.array(z.string()),
  requiresUserReview: z.boolean(),
  insufficientData: z.boolean(),
});
export type GeneratedAnswerContract = z.infer<typeof generatedAnswerContractSchema>;

/** Matches docs/DATA_MODEL.md `generated_answers.user_decision`. */
export const generatedAnswerUserDecisionSchema = z.enum(['APPROVED', 'EDITED', 'SKIPPED']);
export type GeneratedAnswerUserDecision = z.infer<typeof generatedAnswerUserDecisionSchema>;

/**
 * The persisted `generated_answers` row shape. A row with a non-empty unsupportedClaims array
 * failed the rejection gate and must never be surfaced by a user-facing query — see
 * packages/database's listOwnGeneratedAnswersForApplication, which filters these out. Kept in
 * the table only for audit (docs/DATA_MODEL.md `unsupported_claims` column note).
 *
 * insufficientData/rejectionReason/availableFactIds are audit fields populated only on rows
 * this AI pipeline creates, letting a later calibration check compare "what evidence existed"
 * (availableFactIds) vs "what the model claimed to use" (sourceFactIds) vs "what it
 * self-reported" (insufficientData) vs "why the gate rejected it" (rejectionReason).
 * generationRunId/attemptNumber correlate this row back to its ai_usage_events telemetry rows
 * for the same generation run — deliberately not a foreign key (telemetry inserts are
 * best-effort and must never block a generated_answers write).
 */
export const generatedAnswerSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema.nullable(),
  jobId: uuidSchema.nullable(),
  fieldLabel: z.string().min(1),
  fieldClassification: fieldClassificationSchema,
  answer: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sourceFactIds: z.array(uuidSchema),
  reasoningSummary: z.string().nullable(),
  unsupportedClaims: z.array(z.string()),
  requiresUserReview: z.boolean(),
  userDecision: generatedAnswerUserDecisionSchema.nullable(),
  finalText: z.string().nullable(),
  insufficientData: z.boolean().nullable(),
  rejectionReason: generatedAnswerRejectionReasonSchema.nullable(),
  availableFactIds: z.array(uuidSchema).nullable(),
  generationRunId: uuidSchema.nullable(),
  attemptNumber: z.number().int().min(1).max(2).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;

/** Shape packages/ai passes into createOwnGeneratedAnswer — server derives id/userId/timestamps. */
export const generatedAnswerInputSchema = generatedAnswerSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type GeneratedAnswerInput = z.infer<typeof generatedAnswerInputSchema>;

/** Wire body for POST /api/jobs/:id/suggestions. */
export const generateSuggestionRequestSchema = z.object({
  fieldLabel: z.string().min(1),
  fieldClassification: fieldClassificationSchema,
  applicationId: uuidSchema.optional(),
});
export type GenerateSuggestionRequest = z.infer<typeof generateSuggestionRequestSchema>;
