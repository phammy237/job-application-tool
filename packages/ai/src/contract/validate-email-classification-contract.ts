import {
  emailClassificationContractSchema,
  type EmailClassificationContract,
} from '@career-os/shared';

export type EmailClassificationContractValidationResult =
  | { status: 'ok'; result: EmailClassificationContract }
  /** Malformed JSON or a schema violation. No id-allowlist check exists for this contract (see
   * the schema's own doc comment) — it classifies the one message already in the prompt rather
   * than citing retrieved facts, so there is nothing analogous to check-contract's
   * unknown_source_fact_id case. */
  | { status: 'rejected'; reason: 'validation_failed' };

export function validateEmailClassificationContract(
  rawText: string,
): EmailClassificationContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = emailClassificationContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  return { status: 'ok', result: parsed.data };
}
