import {
  containsPhrase,
  generatedAnswerContractSchema,
  type GeneratedAnswerContract,
} from '@career-os/shared';

export type ContractValidationResult =
  | { status: 'ok'; answer: GeneratedAnswerContract }
  /** No usable parse exists — malformed JSON or a schema violation. Nothing to persist. */
  | { status: 'rejected'; reason: 'validation_failed'; answer: null }
  /** Structurally valid but semantically rejected — the answer is carried along so the
   * caller can persist it for audit (docs/DATA_MODEL.md's "kept for audit" column note),
   * filtered out of every user-facing query. `reasoning_leak` is internal to this pipeline only
   * (never persisted under that name — docs/DATA_MODEL.md's rejection_reason CHECK constraint
   * has no such value; callers map it onto 'validation_failed' for storage, same pattern as
   * generate-company-research.ts's own internal-reason mapping). */
  | {
      status: 'rejected';
      reason: 'unknown_source_fact_id' | 'unsupported_claims_present' | 'reasoning_leak';
      answer: GeneratedAnswerContract;
    };

/** Phrases that belong to a model's internal step-by-step reasoning, never to the short
 * user-facing summary reasoningSummary is specified to be (build-system-prompt.ts: "one or two
 * sentences... never your internal reasoning process"). Deliberately short and high-precision —
 * the legitimate format names facts used ("Based on your Acme Corp role..."), which doesn't
 * naturally produce any of these, so a false positive here is unlikely; a missed one only means
 * this heuristic layer didn't catch it, not that grounding itself was bypassed (unsupportedClaims
 * and the fact-id allowlist above remain the actual safety checks). */
const REASONING_LEAK_PHRASES = [
  'let me think',
  'let me',
  'i need to',
  'i should',
  'my reasoning',
  'chain of thought',
  'as an ai',
  "i'm not sure",
  'wait,',
  'hmm,',
  'step by step',
  'first, i',
];

function looksLikeLeakedReasoning(reasoningSummary: string): boolean {
  return REASONING_LEAK_PHRASES.some((phrase) => containsPhrase(reasoningSummary, phrase));
}

/**
 * The checks docs/AI_GROUNDING.md §4 requires before a generated_answers row is ever shown to a
 * user, in order:
 * 1. Zod schema validation (malformed JSON, missing fields, out-of-range confidence all fail
 *    closed) — plus an allowlist check that every sourceFactId was actually placed in the
 *    prompt (allowedFactIds), which defeats both a hallucinated id and an injected one.
 * 2. unsupportedClaims must be empty (Claude's own self-report).
 * 3. reasoningSummary must not read like leaked internal reasoning rather than the short
 *    user-facing summary it's specified to be — a heuristic defense-in-depth layer, not a
 *    replacement for 1-2.
 * All must pass. Any one failing is "rejected", never a partial/best-effort success.
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

  if (looksLikeLeakedReasoning(answer.reasoningSummary)) {
    return { status: 'rejected', reason: 'reasoning_leak', answer };
  }

  return { status: 'ok', answer };
}
