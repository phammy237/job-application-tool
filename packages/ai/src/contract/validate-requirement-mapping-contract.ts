import { requirementMappingRunContractSchema, type RequirementMappingRunContract } from '@career-os/shared';

export type RequirementMappingContractValidationResult =
  | { status: 'ok'; mappings: RequirementMappingRunContract }
  /** No usable parse exists — malformed JSON, a schema violation, or an invariant (MISSING/
   * INFERRED) violation caught by the Zod refinement. Nothing to persist — a Phase 5A run,
   * unlike a Phase 3 generated_answers row, is never persisted on rejection (round-4 addendum
   * §3: "a failed generation must not write mapping rows at all"). */
  | { status: 'rejected'; reason: 'validation_failed' }
  /** Structurally valid but cited an id never offered in <candidate_facts> — defeats both a
   * hallucinated id and one smuggled in via prompt injection, same as the single-field
   * pipeline's contract/validate-contract.ts. */
  | { status: 'rejected'; reason: 'unknown_source_fact_id' };

/**
 * The requirement-mapping analog of contract/validate-contract.ts's two gates: (1) Zod schema
 * validity, including the MISSING/INFERRED structural invariants re-checked as a refinement; (2)
 * every matchedFactIds entry across every mapping must have actually been placed in the prompt.
 * Both must pass. Either failing is "rejected," never a partial/best-effort success — this
 * function only validates the model's shape; requirement-fingerprint deduplication (a separate,
 * async check) happens afterward in generate-requirement-mapping.ts.
 */
export function validateRequirementMappingContract(
  rawText: string,
  allowedFactIds: ReadonlySet<string>,
): RequirementMappingContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = requirementMappingRunContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const mappings = parsed.data;
  const everyIdAllowed = mappings.every((mapping) =>
    mapping.matchedFactIds.every((id) => allowedFactIds.has(id)),
  );
  if (!everyIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  return { status: 'ok', mappings };
}
