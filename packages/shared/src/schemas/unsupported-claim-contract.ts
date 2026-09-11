import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * The model's raw-response contract for ONE already-submitted application answer
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.3) — mirrors the requirement-mapping contract's shape
 * closely (packages/shared/src/schemas/requirement-evidence-mapping.ts): `citedFactIds` is a
 * bare id list allowlist-checked against the exact facts placed in the prompt, same pattern as
 * `matchedFactIds`. Deliberately does NOT ask the model to echo back which answer this refers to
 * — the caller sends answers in a fixed order and expects the response array back in that same
 * order (validated by length, see validateUnsupportedClaimContract), so there is no id for the
 * model to get wrong or hallucinate for that part of the contract at all.
 */
export const unsupportedClaimSupportStatusSchema = z.enum([
  'SUPPORTED',
  'UNSUPPORTED',
  'UNCERTAIN',
]);
export type UnsupportedClaimSupportStatus = z.infer<
  typeof unsupportedClaimSupportStatusSchema
>;

export const unsupportedClaimEntryContractSchema = z.object({
  supportStatus: unsupportedClaimSupportStatusSchema,
  /** Every id the model believes supports this answer, if any. Must be a subset of the ids
   * actually placed in the prompt — checked by the caller, not by this schema alone. */
  citedFactIds: z.array(uuidSchema),
  /** One or two sentences, user-facing — never raw chain-of-thought, same posture as
   * generatedAnswerContractSchema.reasoningSummary. */
  explanation: z.string().min(1).max(400),
});
export type UnsupportedClaimEntryContract = z.infer<
  typeof unsupportedClaimEntryContractSchema
>;

/** Bounds worst-case prompt/response size, same rationale as MAX_REQUIREMENTS_PER_RUN. */
export const MAX_ANSWERS_PER_UNSUPPORTED_CLAIM_CHECK = 30;

export const unsupportedClaimCheckContractSchema = z
  .array(unsupportedClaimEntryContractSchema)
  .max(MAX_ANSWERS_PER_UNSUPPORTED_CLAIM_CHECK);
export type UnsupportedClaimCheckContract = z.infer<
  typeof unsupportedClaimCheckContractSchema
>;
