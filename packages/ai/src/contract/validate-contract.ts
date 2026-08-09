import { generatedAnswerContractSchema, type GeneratedAnswerContract } from '@career-os/shared';

export type ContractValidationResult =
  | { status: 'ok'; answer: GeneratedAnswerContract }
  /** No usable parse exists — malformed JSON or a schema violation. Nothing to persist. */
  | { status: 'rejected'; reason: 'validation_failed'; answer: null }
  /** Structurally valid but semantically rejected — the answer is carried along so the
   * caller can persist it for audit (docs/DATA_MODEL.md's "kept for audit" column note),
   * filtered out of every user-facing query. */
  | {
      status: 'rejected';
      reason: 'unknown_source_fact_id' | 'unsupported_claims_present';
      answer: GeneratedAnswerContract;
    };

/**
 * The two independent checks docs/AI_GROUNDING.md §4 requires before a generated_answers row
 * is ever shown to a user, in order:
 * 1. Zod schema validation (malformed JSON, missing fields, out-of-range confidence all fail
 *    closed) — plus an allowlist check that every sourceFactId was actually placed in the
 *    prompt (allowedFactIds), which defeats both a hallucinated id and an injected one.
 * 2. unsupportedClaims must be empty (Claude's own self-report).
 * Both must pass. Either failing is "rejected", never a partial/best-effort success.
 */
export function validateContract(
  rawText: string,
  allowedFactIds: ReadonlySet<string>,
): ContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed', answer: null };
  }

  const parsed = generatedAnswerContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed', answer: null };
  }

  const answer = parsed.data;

  if (!answer.sourceFactIds.every((id) => allowedFactIds.has(id))) {
    return { status: 'rejected', reason: 'unknown_source_fact_id', answer };
  }

  if (answer.unsupportedClaims.length > 0) {
    return { status: 'rejected', reason: 'unsupported_claims_present', answer };
  }

  return { status: 'ok', answer };
}
