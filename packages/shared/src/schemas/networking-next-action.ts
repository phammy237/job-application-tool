import { z } from 'zod';
import { isoDateTimeSchema } from './common';
import { nextActionPrioritySchema } from './next-action';

/**
 * Phase 6C — the deterministic networking next-action engine's output vocabulary
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6C"). Deliberately narrow: this is not the application
 * `NextActionType` enum reused for a second domain (a networking action and an application
 * action are never the same kind of thing, and forcing one enum to cover both would blur that),
 * but it is also deliberately NOT the full set of networking actions a product doc might
 * eventually want.
 *
 * `SEND_THANK_YOU` was considered and explicitly deferred — see the Phase 6C design note in
 * docs/IMPLEMENTATION_PLAN.md for the full reasoning. Short version: the Phase 6B interaction
 * model (`interaction_type`, `direction`, `occurred_at`, `subject`, `notes`, `application_id`)
 * has no signal for whether a thank-you was already sent (in person, outside Career OS, or
 * logged under a different interaction type), so a rule like "coffee chat yesterday with no
 * later interaction → suggest a thank-you" would be guessing, not deriving. `ASK_FOR_REFERRAL`,
 * `RECONNECT`, `REQUEST_INTRO`, and similar are excluded for the same reason, more obviously —
 * none of that context exists in this schema at all.
 */
export const networkingNextActionTypeSchema = z.enum(['FOLLOW_UP_WITH_CONTACT', 'NO_ACTION']);
export type NetworkingNextActionType = z.infer<typeof networkingNextActionTypeSchema>;

/**
 * What persisted fact this action was derived from — the networking-domain equivalent of
 * `NextActionSource` (next-action.ts), same purpose: lets the UI (and, later, any AI assistance)
 * distinguish a user-requested reminder from a Career OS-generated suggestion without guessing.
 * Only one value exists because only one signal feeds this engine in Phase 6C.
 */
export const networkingNextActionSourceSchema = z.enum(['EXPLICIT_FOLLOW_UP_REMINDER']);
export type NetworkingNextActionSource = z.infer<typeof networkingNextActionSourceSchema>;

/**
 * The pure rule engine's output shape (`networking-next-action-rules.ts`). Reuses
 * `nextActionPrioritySchema` rather than a second, identical five-level enum
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §8) — this engine only ever emits `MEDIUM` or `NONE`;
 * `URGENT`/`HIGH` are never appropriate for a networking reminder (it never outranks a real
 * application deadline or employer ask), and that constraint is enforced in the rule engine
 * itself, not by narrowing the shared type.
 *
 * No title/reason fields, same reasoning as `NextAction` — UI text is produced by a separate
 * formatter (`format-networking-next-action.ts`) from this structured data.
 */
export const networkingNextActionSchema = z.object({
  type: networkingNextActionTypeSchema,
  priority: nextActionPrioritySchema,
  source: networkingNextActionSourceSchema,
  /** The one real fact this engine ever reads — `contacts.followUpAt` exactly as persisted.
   * Never a fabricated or inferred date; null whenever no reminder is set. */
  followUpAt: isoDateTimeSchema.nullable(),
});
export type NetworkingNextAction = z.infer<typeof networkingNextActionSchema>;
