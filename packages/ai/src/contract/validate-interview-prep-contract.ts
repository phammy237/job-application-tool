import {
  interviewPrepModelContractSchema,
  type InterviewPrepModelContract,
} from '@career-os/shared';

export type InterviewPrepContractValidationResult =
  | { status: 'ok'; prep: InterviewPrepModelContract }
  /** Malformed JSON or a schema violation. */
  | { status: 'rejected'; reason: 'validation_failed' }
  /** Structurally valid but cited a factId/requirementId never offered in the prompt — same
   * defense as validateRequirementMappingContract/validateUnsupportedClaimContract against a
   * hallucinated or prompt-injected id. */
  | { status: 'rejected'; reason: 'unknown_source_fact_id' };

/**
 * The interview-prep analog of validateRequirementMappingContract: (1) Zod schema validity; (2)
 * every sourceFactIds entry (evidenceToEmphasize, starStoryPrompts) and every
 * sourceRequirementId/sourceRequirementIds entry (rolePriorities, possibleQuestions,
 * gapsToPrepare) must have actually been placed in the prompt. A single shared rejection reason
 * covers both id kinds — same precedent as the other pipelines reusing a shared, narrow
 * rejection-reason enum rather than widening it per pipeline.
 */
export function validateInterviewPrepContract(
  rawText: string,
  allowedFactIds: ReadonlySet<string>,
  allowedRequirementIds: ReadonlySet<string>,
): InterviewPrepContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = interviewPrepModelContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const prep = parsed.data;

  const everyFactIdAllowed = [
    ...prep.evidenceToEmphasize,
    ...prep.starStoryPrompts,
  ].every((entry) => entry.sourceFactIds.every((id) => allowedFactIds.has(id)));
  if (!everyFactIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  const everySingleRequirementIdAllowed = [
    ...prep.rolePriorities,
    ...prep.gapsToPrepare,
  ].every(
    (entry) =>
      entry.sourceRequirementId === null ||
      allowedRequirementIds.has(entry.sourceRequirementId),
  );
  if (!everySingleRequirementIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  const everyRequirementIdListAllowed = prep.possibleQuestions.every((entry) =>
    entry.sourceRequirementIds.every((id) => allowedRequirementIds.has(id)),
  );
  if (!everyRequirementIdListAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  return { status: 'ok', prep };
}
