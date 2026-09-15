import {
  findUngroundedNumericClaims,
  findUngroundedTechnologyTokens,
  interviewPrepModelContractSchema,
  type InterviewPrepModelContract,
} from '@career-os/shared';

export type InterviewPrepContractValidationResult =
  | { status: 'ok'; prep: InterviewPrepModelContract }
  /** Malformed JSON or a schema violation. */
  | { status: 'rejected'; reason: 'validation_failed' }
  /** Structurally valid but cited a factId/requirementId/researchFindingId never offered in the
   * prompt — same defense as validateRequirementMappingContract/validateUnsupportedClaimContract
   * against a hallucinated or prompt-injected id. A single shared rejection reason covers all
   * three id kinds, same precedent this file already used pre-Phase-7I for fact/requirement ids. */
  | { status: 'rejected'; reason: 'unknown_source_fact_id' }
  /** Phase 7I (docs/IMPLEMENTATION_PLAN.md "Phase 7I" — candidate-fact safety) — an
   * `evidenceToEmphasize`/`starStoryPrompts` entry's own text introduces a number/technology not
   * present anywhere in its cited approved facts. This is the structural guarantee that a
   * company-research finding — never included in the evidence text these guards compare against,
   * no matter how many findings the entry cites via `researchFindingIds` — can never launder an
   * otherwise-ungrounded candidate claim through this pipeline. */
  | { status: 'rejected'; reason: 'ungrounded_number' }
  | { status: 'rejected'; reason: 'ungrounded_technology' };

export interface InterviewPrepAllowlists {
  /** Every approved fact id actually placed in this request's prompt — request-local. */
  factIds: ReadonlySet<string>;
  /** Text for every id in `factIds`, used ONLY to build the evidence corpus the numeric/
   * technology guards check `evidenceToEmphasize`/`starStoryPrompts` text against (Phase 7I) —
   * this map must never be extended with anything from `<company_research_snapshot>`. */
  factTextById: ReadonlyMap<string, string>;
  /** Every requirement id actually placed in this request's prompt (a CURRENT requirement-
   * mapping run's ids, or empty when none exists). */
  requirementIds: ReadonlySet<string>;
  /** Phase 7I — every company-research finding id actually placed in this request's prompt,
   * scoped to the ONE snapshot resolved for this request. Empty when `researchMode` is
   * `JOB_ONLY` or no snapshot was resolved — a `researchFindingIds` citation is then always
   * rejected, exactly like citing a fact id that was never offered. */
  researchFindingIds: ReadonlySet<string>;
}

/**
 * The interview-prep analog of validateRequirementMappingContract: (1) Zod schema validity; (2)
 * every sourceFactIds entry (evidenceToEmphasize, starStoryPrompts) and every
 * sourceRequirementId/sourceRequirementIds entry (rolePriorities, possibleQuestions,
 * gapsToPrepare) must have actually been placed in the prompt; (3) Phase 7I: every
 * researchFindingIds entry (on every item type) must have actually been offered in this request's
 * `<company_research_snapshot>` section; (4) Phase 7I: `evidenceToEmphasize`/`starStoryPrompts`
 * text must not introduce a number/technology unsupported by its own cited approved-fact text —
 * the same deterministic guards Phase 7E's résumé tailoring already uses
 * (`resume-tailoring-numeric-guard.ts`/`resume-tailoring-technology-guard.ts`), reused here
 * unmodified rather than reimplemented, and — critically — never given research-finding text as
 * evidence, which is what structurally guarantees a company fact can never become a candidate
 * fact through this pipeline.
 */
export function validateInterviewPrepContract(
  rawText: string,
  allowlists: InterviewPrepAllowlists,
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
  ].every((entry) => entry.sourceFactIds.every((id) => allowlists.factIds.has(id)));
  if (!everyFactIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  const everySingleRequirementIdAllowed = [
    ...prep.rolePriorities,
    ...prep.gapsToPrepare,
  ].every(
    (entry) =>
      entry.sourceRequirementId === null ||
      allowlists.requirementIds.has(entry.sourceRequirementId),
  );
  if (!everySingleRequirementIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  const everyRequirementIdListAllowed = prep.possibleQuestions.every((entry) =>
    entry.sourceRequirementIds.every((id) => allowlists.requirementIds.has(id)),
  );
  if (!everyRequirementIdListAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  // Phase 7I — every researchFindingIds entry, on every item type, must resolve against this
  // request's own allowlist. Empty allowlist (JOB_ONLY, or no compatible snapshot) means ANY
  // citation here is rejected, by construction.
  const allItems = [
    ...prep.rolePriorities,
    ...prep.evidenceToEmphasize,
    ...prep.starStoryPrompts,
    ...prep.possibleQuestions,
    ...prep.questionsToAsk,
    ...prep.gapsToPrepare,
  ];
  const everyResearchFindingIdAllowed = allItems.every((entry) =>
    entry.researchFindingIds.every((id) => allowlists.researchFindingIds.has(id)),
  );
  if (!everyResearchFindingIdAllowed) {
    return { status: 'rejected', reason: 'unknown_source_fact_id' };
  }

  // Phase 7I — candidate-fact safety: evidenceTexts is built ONLY from this entry's own cited
  // approved-fact text, exactly like Phase 7E's REWRITE_BULLET/ADD_BULLET guard (there is no
  // "original text" analog here — every entry is new synthesized text, so evidence is only the
  // cited facts, same as Phase 7E's ADD_BULLET case). Research-finding text is never appended to
  // this array anywhere in this function, regardless of `researchFindingIds`.
  for (const entry of [...prep.evidenceToEmphasize, ...prep.starStoryPrompts]) {
    const evidenceTexts = entry.sourceFactIds
      .map((id) => allowlists.factTextById.get(id))
      .filter((text): text is string => Boolean(text));
    const text = 'summary' in entry ? entry.summary : entry.prompt;

    const ungroundedNumbers = findUngroundedNumericClaims(text, evidenceTexts);
    if (ungroundedNumbers.length > 0) {
      return { status: 'rejected', reason: 'ungrounded_number' };
    }
    const ungroundedTech = findUngroundedTechnologyTokens(text, evidenceTexts);
    if (ungroundedTech.length > 0) {
      return { status: 'rejected', reason: 'ungrounded_technology' };
    }
  }

  return { status: 'ok', prep };
}
