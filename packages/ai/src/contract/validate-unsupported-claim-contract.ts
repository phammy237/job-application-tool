import {
  unsupportedClaimCheckContractSchema,
  type UnsupportedClaimCheckContract,
} from '@career-os/shared';

export type UnsupportedClaimContractValidationResult =
  | { status: 'ok'; entries: UnsupportedClaimCheckContract }
  /** Malformed JSON or a schema violation — nothing usable, never surfaced to the user. */
  | { status: 'rejected'; reason: 'validation_failed' }
  /** Structurally valid but cited an id never offered in <candidate_facts> — same defense against
   * a hallucinated or prompt-injected id as validateRequirementMappingContract. */
  | { status: 'rejected'; reason: 'unknown_source_fact_id' }
  /** The response array's length didn't match the number of answers actually sent — since answer
   * identity is positional (the model is never asked to echo an id, deliberately — see
   * unsupportedClaimEntryContractSchema's doc comment), a mismatched length means there is no
   * safe way to know which entry corresponds to which answer. Rejected outright rather than
   * guessed. */
  | { status: 'rejected'; reason: 'wrong_length' };

/**
 * The unsupported-claim-check analog of validateRequirementMappingContract: (1) Zod schema
 * validity; (2) every citedFactIds entry across every array element must have actually been
 * placed in the prompt; (3) the response array must have exactly one entry per answer sent, in
 * order — this pipeline's own extra invariant, since positional correspondence is how answer
 * identity is established (never a model-echoed id).
 */
export function validateUnsupportedClaimContract(
  rawText: string,
  allowedFactIds: ReadonlySet<string>,
  expectedLength: number,
): UnsupportedClaimContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = unsupportedClaimCheckContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const entries = parsed.data;
  if (entries.length !== expectedLength) {
    return { status: 'rejected', reason: 'wrong_length' };
  }

  const everyIdAllowed = entries.every((entry) =>
    entry.citedFactIds.every((id) => allowedFactIds.has(id)),
  );
  if (!everyIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  return { status: 'ok', entries };
}
