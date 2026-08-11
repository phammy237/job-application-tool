import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { fieldClassificationSchema } from './detected-field';
import { generatedAnswerRejectionReasonSchema } from './generated-answer';

/** Null when no provider call was attempted (deterministic short-circuit, or a deliberately
 * skipped escalation slot). */
export const aiUsageEventProviderSchema = z.enum(['anthropic', 'openai']).nullable();
export type AiUsageEventProvider = z.infer<typeof aiUsageEventProviderSchema>;

export const aiUsageEventLadderSchema = z.enum(['deterministic', 'normal', 'premium']);
export type AiUsageEventLadder = z.infer<typeof aiUsageEventLadderSchema>;

/**
 * 'escalated' marks an attempt that passed the grounding gate but was not used as final
 * (currently only the NORMAL ladder's passed-but-low-confidence case) — distinct from
 * 'accepted', which means this specific attempt's answer is the one that was persisted.
 * 'skipped' marks a ladder slot that was deliberately never called (a non-retryable rejection
 * on attempt 1 means there is no attempt 2). 'deterministic' marks the zero-cost profile
 * short-circuit, which never calls a provider at all.
 */
export const aiUsageEventOutcomeSchema = z.enum([
  'accepted',
  'rejected',
  'escalated',
  'refusal',
  'provider_error',
  'skipped',
  'deterministic',
]);
export type AiUsageEventOutcome = z.infer<typeof aiUsageEventOutcomeSchema>;

/**
 * Set only on the row for an attempt that *causes* a second attempt to happen, naming why.
 * Null on every final attempt (accepted, a non-retryable rejection, or any attempt 2 — nothing
 * escalates further from those). Kept as its own narrow enum rather than reusing
 * rejectionReason/outcome directly, since "why did we move on" and "why did the gate reject
 * this" are related but distinct questions (a passed-but-low-confidence attempt has no
 * rejection reason at all, for instance).
 */
export const aiUsageEventEscalationReasonSchema = z
  .enum(['low_confidence', 'retryable_rejection', 'provider_error', 'refusal'])
  .nullable();
export type AiUsageEventEscalationReason = z.infer<typeof aiUsageEventEscalationReasonSchema>;

/** One member today — not a generic task-type dispatcher, just enough for telemetry rows to
 * carry the right value. Extend when a second real caller exists. */
export const aiUsageEventTaskTypeSchema = z.enum(['field_suggestion']);
export type AiUsageEventTaskType = z.infer<typeof aiUsageEventTaskTypeSchema>;

/**
 * One row per provider attempt (or deterministic short-circuit, or deliberately-skipped
 * escalation slot) within a `generate-suggestion.ts` execution. `generationRunId` correlates
 * every row from the same execution; `attemptNumber` (1 or 2) plus `ladder` reconstructs the
 * full NORMAL/PREMIUM decision path.
 *
 * This schema is forward-looking groundwork: `generate-suggestion.ts` is currently
 * single-provider (Claude Sonnet only) and never calls recordAiUsageEvent, so no row with a
 * non-null `provider`/`ladder` other than the single-path case exists yet in practice. See
 * docs/AI_GROUNDING.md and docs/IMPLEMENTATION_PLAN.md's Phase 3 note on this table.
 */
export const aiUsageEventSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema.nullable(),
  generationRunId: uuidSchema,
  attemptNumber: z.number().int().min(1).max(2),
  ladder: aiUsageEventLadderSchema,
  fieldClassification: fieldClassificationSchema,
  provider: aiUsageEventProviderSchema,
  model: z.string().nullable(),
  taskType: aiUsageEventTaskTypeSchema,
  providerSucceeded: z.boolean().nullable(),
  outcome: aiUsageEventOutcomeSchema,
  rejectionReason: generatedAnswerRejectionReasonSchema.nullable(),
  escalationReason: aiUsageEventEscalationReasonSchema,
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCost: z.number().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AiUsageEvent = z.infer<typeof aiUsageEventSchema>;

/** Shape packages/ai passes into recordAiUsageEvent — server derives id/userId/createdAt. */
export const aiUsageEventInputSchema = aiUsageEventSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type AiUsageEventInput = z.infer<typeof aiUsageEventInputSchema>;
