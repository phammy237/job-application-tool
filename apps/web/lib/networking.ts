import {
  deriveNetworkingNextAction,
  type Contact,
  type NetworkingNextAction,
} from '@career-os/shared';

/**
 * Server-side data assembly for networking follow-ups (docs/IMPLEMENTATION_PLAN.md "Phase 6C"
 * §24) — deliberately separate from the pure rule engine in `packages/shared`, the same split
 * Phase 5C.2H established for the application dashboard (`apps/web/lib/dashboard.ts`). This file
 * wires an already-fetched `Contact[]` together with `deriveNetworkingNextAction`; it never
 * calls Supabase itself.
 */
export interface ContactWithNetworkingNextAction {
  contact: Contact;
  nextAction: NetworkingNextAction;
}

export function attachNetworkingNextActions(
  contacts: Contact[],
  now: string,
): ContactWithNetworkingNextAction[] {
  return contacts.map((contact) => ({
    contact,
    nextAction: deriveNetworkingNextAction({ followUpAt: contact.followUpAt, now }),
  }));
}

/**
 * Earliest-due-first, then a stable display-name tie-break (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6C" §19) — deliberately not a priority-based sort like the application dashboard's
 * `compareByAttention`: every item this function is meant to sort already shares the same
 * networking priority (a due follow-up), so the only thing left to order by is the reminder
 * itself. Does not filter — callers that only want due items should filter by
 * `nextAction.type === 'FOLLOW_UP_WITH_CONTACT'` first (or use
 * `listOwnContactsWithDueFollowUp`, which is already filtered server-side).
 */
export function sortContactsByFollowUpDue(
  items: ContactWithNetworkingNextAction[],
): ContactWithNetworkingNextAction[] {
  return [...items].sort((a, b) => {
    const aAt = a.contact.followUpAt;
    const bAt = b.contact.followUpAt;
    if (aAt && bAt) {
      const diff = new Date(aAt).getTime() - new Date(bAt).getTime();
      if (diff !== 0) return diff;
    } else if (aAt || bAt) {
      // A contact with a reminder sorts before one without, defensively — every real caller of
      // this function only ever passes contacts that already have one.
      return aAt ? -1 : 1;
    }
    return a.contact.displayName.localeCompare(b.contact.displayName);
  });
}
