import type { NetworkingNextAction } from '../schemas/networking-next-action';

/**
 * Turns a `NetworkingNextAction` into UI text — deliberately separate from
 * `networking-next-action-rules.ts`, the same split Phase 5C established for applications
 * (`format-next-action.ts`): wording changes never touch the rule engine, and the rule engine's
 * own tests never need to assert exact prose.
 *
 * Deliberately does NOT format `followUpAt` into a calendar date string here — that requires a
 * locale/timezone-aware `Date` conversion, and every other date shown in this product's UI
 * (application timestamps, Phase 6B interaction timestamps) is formatted directly in the web
 * component via `toLocaleString()`/`toLocaleDateString()`, never inside `packages/shared`, to
 * avoid a server/client timezone mismatch. Callers that want "Follow up on Sep 20" build that
 * string themselves from `action.followUpAt`, the same way the Phase 6B interaction timeline
 * already does for its own timestamps.
 *
 * Copy is deliberately factual, never judgmental (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §12) —
 * this is the user's own reminder, not Career OS evaluating the relationship. Never says
 * "neglected," "overdue," or "you should have."
 */
export interface FormattedNetworkingNextAction {
  title: string;
  reason: string;
}

export function formatNetworkingNextAction(
  action: NetworkingNextAction,
): FormattedNetworkingNextAction {
  switch (action.type) {
    case 'FOLLOW_UP_WITH_CONTACT':
      return {
        title: 'Follow up',
        reason: 'You set a reminder to follow up with this contact, and it is now due.',
      };
    case 'NO_ACTION':
      return {
        title: 'No action needed',
        reason: action.followUpAt
          ? 'Your follow-up reminder for this contact is not due yet.'
          : 'No follow-up reminder is set for this contact.',
      };
  }
}
