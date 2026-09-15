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
export type AiUsageEventEscalationReason = z.infer<
  typeof aiUsageEventEscalationReasonSchema
>;

/** 'requirement_mapping' added in migration 0010 (Phase 5A) — packages/ai's
 * generate-requirement-mapping.ts is this table's first real caller (generate-suggestion.ts still
 * has none — see the schema doc comment below). 'email_classification' added in migration 0012
 * (Phase 5) for packages/ai's generate-email-classification.ts, the Claude fallback used only for
 * messages the deterministic classifier in packages/email can't confidently resolve.
 * 'unsupported_claim_check' added in migration 0014 (Phase 5B.3) for packages/ai's
 * generate-unsupported-claims-check.ts — the explicit, user-triggered advisory check, never
 * called automatically and never part of the authoritative mark-applied gate. 'follow_up_draft'
 * and 'interview_prep' added in migration 0016 (Phase 5C.3) for packages/ai's
 * generate-follow-up-draft.ts / generate-interview-prep.ts — both explicit, user-triggered AI
 * *assistance* on top of the deterministic next-action engine's decision, never the thing that
 * makes the decision itself (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3"). 'resume_tailoring'
 * added in migration 0023 (Phase 7E) for packages/ai's generate-resume-tailoring-plan.ts — an
 * explicit, user-triggered, ephemeral generation of a semantic edit plan against a copy of the
 * base résumé; never a persisted result row, only this telemetry event
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §21/§45). 'company_research' added in migration 0026
 * (Phase 7G) for packages/ai's generate-company-research.ts — an explicit, user-triggered
 * synthesis of structured, source-cited findings about a company, from sources a separate,
 * non-AI search/extraction step already discovered; the persisted result is a real
 * `company_research_snapshots` row (unlike every task type before it, whose only durable trace
 * is this same telemetry event), so this row records the *generation attempt*, not the snapshot
 * itself (docs/IMPLEMENTATION_PLAN.md "Phase 7G"). */
export const aiUsageEventTaskTypeSchema = z.enum([
  'field_suggestion',
  'requirement_mapping',
  'email_classification',
  'unsupported_claim_check',
  'follow_up_draft',
  'interview_prep',
  'resume_tailoring',
  'company_research',
]);
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
  /** Nullable since migration 0010 — a requirement_mapping task_type analyzes a whole posting,
   * not one classified form field, so no single FieldClassification applies. Non-null for every
   * field_suggestion row, as before. */
  fieldClassification: fieldClassificationSchema.nullable(),
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
  /** Added in migration 0010 — null for every pre-Phase-5A row (and for field_suggestion rows,
   * which don't set it either, since that pipeline has no live recordAiUsageEvent call site). */
  promptVersion: z.string().nullable(),
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
