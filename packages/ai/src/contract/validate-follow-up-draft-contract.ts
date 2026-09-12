import {
  followUpDraftModelContractSchema,
  type FollowUpDraftModelContract,
} from '@career-os/shared';

/**
 * A fixed, hand-written denylist of phrases that, in a follow-up drafted for
 * CONSIDER_FOLLOW_UP-eligible applications specifically, can only ever be a fabrication —
 * enforcing 5C.3M's hard rule ("Follow-up email cannot say 'I recently spoke with...', 'I was
 * referred by...', 'I enjoyed our interview...', 'I completed the assessment...' unless Career OS
 * has trusted persisted evidence of that exact fact"). This pipeline never has such evidence to
 * give the model in the first place — nothing in this schema tracks a phone call, a referral
 * relationship, or an exact application channel, and drafting is only ever eligible while the
 * deterministic next action is CONSIDER_FOLLOW_UP (status APPLIED/APPLICATION_RECEIVED — i.e.
 * before any interview or assessment stage), so any of these claims is self-contradictory by
 * construction, not merely unverifiable. This is a defensive net on top of the system prompt's
 * explicit instruction, not a substitute for it — free-text output can still slip past a fixed
 * phrase list, but this catches the exact fabrication shapes the phase brief calls out and keeps
 * them testable.
 */
const FABRICATION_RISK_PHRASES = [
  'spoke with',
  'spoke to',
  'speaking with',
  'speaking to',
  'talked with',
  'talked to',
  'talking with',
  'talking to',
  'phone call',
  'phone screen',
  'our call',
  'referred by',
  'referral from',
  'was referred',
  'our interview',
  'the interview we had',
  'after our interview',
  'since our interview',
  'great meeting the team',
  'great meeting you',
  'it was great to meet',
  'completed the assessment',
  'finished the assessment',
  'took the assessment',
  'completed your assessment',
  'technical screen',
  'our conversation',
  'our meeting',
  'met with',
  'meeting with',
];

export function containsFabricationRiskPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  return FABRICATION_RISK_PHRASES.find((phrase) => lower.includes(phrase)) ?? null;
}

export type FollowUpDraftContractValidationResult =
  | { status: 'ok'; draft: FollowUpDraftModelContract }
  /** Malformed JSON or a schema violation. */
  | { status: 'rejected'; reason: 'validation_failed' }
  /** The body matched a fabrication-risk phrase from the fixed denylist above. Recorded to
   * telemetry as 'validation_failed' (docs/DATA_MODEL.md's shared rejection_reason CHECK
   * constraint has no more specific value, same precedent as
   * validate-unsupported-claim-contract.ts's 'wrong_length'), but kept as its own distinct reason
   * here so the retry prompt can name the exact problem. */
  | { status: 'rejected'; reason: 'fabricated_interaction_claim' };

export function validateFollowUpDraftContract(
  rawText: string,
): FollowUpDraftContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = followUpDraftModelContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  if (containsFabricationRiskPhrase(parsed.data.body)) {
    return { status: 'rejected', reason: 'fabricated_interaction_claim' };
  }

  return { status: 'ok', draft: parsed.data };
}
