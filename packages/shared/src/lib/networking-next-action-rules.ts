import type {
  NetworkingNextAction,
  NetworkingNextActionSource,
  NetworkingNextActionType,
} from '../schemas/networking-next-action';

/**
 * Phase 6C — the deterministic networking next-action engine (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6C"). Pure, deterministic, no database access, no network access, no Claude — a plain
 * function of its arguments, the exact same posture as `next-action-rules.ts` (applications) and
 * `consistency-rules.ts`. All data assembly (fetching the contact row, deciding what "now" is)
 * happens in the caller (`apps/web/lib/networking.ts`); this module only ever computes from what
 * it's given.
 *
 * Only one rule exists in this phase: an explicit, user-set `followUpAt` that has arrived.
 * Deliberately does NOT infer relationship strength, whether someone "likes" the user, whether a
 * referral or introduction is socially appropriate, or that a contact has been "neglected" — see
 * docs/IMPLEMENTATION_PLAN.md "Phase 6C" §1 for the full list of social-pressure mechanics this
 * engine must never produce. The only fact it ever reasons about is a timestamp the user
 * themselves chose.
 */
export interface NetworkingNextActionRuleInput {
  /** Exactly `contacts.followUpAt` — null means no reminder is set. */
  followUpAt: string | null;
  /** Injected, never read internally via `Date.now()`/`new Date()` — keeps this function a
   * pure, deterministically-testable function of its arguments. */
  now: string;
}

function build(
  type: NetworkingNextActionType,
  priority: NetworkingNextAction['priority'],
  source: NetworkingNextActionSource,
  followUpAt: string | null,
): NetworkingNextAction {
  return { type, priority, source, followUpAt };
}

/**
 * A reminder is "due" the moment it arrives, not before — a future `followUpAt` is a fact worth
 * displaying (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §16: "Follow up Sep 20"), but it is
 * deliberately NOT yet an actionable next action; calling it "attention needed" before its own
 * chosen date would misrepresent the user's own intent. `<=` (not `<`) so a reminder set for
 * exactly "now" counts as due immediately, matching the product rule in docs/IMPLEMENTATION_PLAN.md
 * "Phase 6C" §9 verbatim ("follow_up_at <= now").
 */
export function deriveNetworkingNextAction(
  input: NetworkingNextActionRuleInput,
): NetworkingNextAction {
  if (input.followUpAt === null) {
    return build('NO_ACTION', 'NONE', 'EXPLICIT_FOLLOW_UP_REMINDER', null);
  }

  const isDue = new Date(input.followUpAt).getTime() <= new Date(input.now).getTime();
  if (isDue) {
    return build('FOLLOW_UP_WITH_CONTACT', 'MEDIUM', 'EXPLICIT_FOLLOW_UP_REMINDER', input.followUpAt);
  }
  return build('NO_ACTION', 'NONE', 'EXPLICIT_FOLLOW_UP_REMINDER', input.followUpAt);
}
