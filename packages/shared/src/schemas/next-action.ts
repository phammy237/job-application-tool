import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * Phase 5C.1 — the deterministic next-action engine's output vocabulary
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.1"). One type per meaningfully-different thing the user
 * might do next; deliberately narrower than "one per applications.status value" wherever a
 * status alone doesn't yet tell the user what to actually do (SAVED/IN_PROGRESS collapse into
 * REVIEW_UNRESOLVED_FIELDS/COMPLETE_APPLICATION/MARK_APPLIED depending on real recorded progress,
 * not the status label).
 */
export const nextActionTypeSchema = z.enum([
  /** SAVED or IN_PROGRESS with at least one unresolved field recorded — review those first,
   * before anything else, regardless of how much other work has happened. */
  'REVIEW_UNRESOLVED_FIELDS',
  /** SAVED, with no unresolved-field record at all (an application that was created but never
   * run through the extension's review flow, or ran through it with nothing left to resolve and
   * nothing approved either) — there's real work to do before this is ready to submit. */
  'COMPLETE_APPLICATION',
  /** IN_PROGRESS, with no unresolved fields left — everything Career OS could help review has
   * been reviewed; the next step is to actually submit on the employer's site and record it. */
  'MARK_APPLIED',
  /** status = ACTION_REQUIRED — the employer (via a confirmed Gmail signal or a manual status
   * change) is explicitly asking for something. */
  'REVIEW_ACTION_REQUIRED',
  /** status = ASSESSMENT. */
  'COMPLETE_ASSESSMENT',
  /** status = INTERVIEW. */
  'PREPARE_INTERVIEW',
  /** status = OFFER. */
  'REVIEW_OFFER',
  /** status = APPLIED or APPLICATION_RECEIVED, and enough time has passed with no newer
   * employer-driven status change for Career OS's follow-up heuristic to suggest checking in —
   * see FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS. Always a Career OS recommendation, never a claim
   * about an employer deadline or promise. */
  'CONSIDER_FOLLOW_UP',
  /** status = UNKNOWN — reachable in the type system (every ApplicationStatus must map to
   * something) but not written by any code path today; a safe fallback rather than a crash. */
  'REVIEW_APPLICATION',
  /** status = APPLIED/APPLICATION_RECEIVED before the follow-up threshold, or REJECTED/
   * WITHDRAWN. Nothing for the user to do right now. */
  'NO_ACTION',
]);
export type NextActionType = z.infer<typeof nextActionTypeSchema>;

/**
 * Deliberately five levels, not a numeric score — a score would invite false precision this
 * engine has no basis for (docs/IMPLEMENTATION_PLAN.md "Phase 5C.1B"). URGENT is reserved for a
 * state that genuinely needs attention soon (an explicit employer ask, or a live offer decision);
 * a Career OS-generated suggestion like CONSIDER_FOLLOW_UP is never URGENT, since it is advice,
 * not a fact about employer expectations.
 */
export const nextActionPrioritySchema = z.enum([
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
]);
export type NextActionPriority = z.infer<typeof nextActionPrioritySchema>;

/**
 * What persisted fact this action was derived from — lets the UI explain itself
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.1I"). Every value here corresponds to a field the
 * engine actually reads; there is no "AI_JUDGMENT" or "MODEL_INFERENCE" source, because none
 * exists — Phase 5C.1 never calls a model to decide any of this.
 */
export const nextActionSourceSchema = z.enum([
  /** applications.status directly (including a status only Gmail/email-signal confirmation
   * could have produced — by the time it reaches this engine, status is already the single
   * reconciled fact, so the engine never separately re-derives from email_signals itself). */
  'APPLICATION_STATUS',
  /** applications.unresolvedFields — a non-empty array. */
  'UNRESOLVED_FIELDS',
  /** The follow-up heuristic's anchor (appliedAt, or a later meaningful employer-driven status
   * change if one exists — see next-action-rules.ts's `lastMeaningfulEmployerActivityAt`)
   * compared against "now". Always paired with a real, persisted timestamp; never a fabricated
   * or inferred date. */
  'TIME_SINCE_APPLICATION',
  /** status = UNKNOWN, a reachable-but-unwritten enum value. */
  'UNKNOWN_STATUS',
]);
export type NextActionSource = z.infer<typeof nextActionSourceSchema>;

/**
 * The pure rule engine's output shape (docs/IMPLEMENTATION_PLAN.md "Phase 5C.1A"). Deliberately
 * has NO title/reason string fields — those are UI text, produced by a separate formatter
 * (packages/shared/src/lib/format-next-action.ts) from this structured data, so wording changes
 * never touch the rule engine and the rule engine's own tests never need to assert exact prose.
 *
 * `dueAt` is typed as `z.null()`, not `isoDateTimeSchema.nullable()` — not an oversight. No
 * table in this schema persists a trusted employer deadline/interview-date/assessment-due-date
 * today (checked directly against docs/DATA_MODEL.md and every relevant migration before writing
 * this), so this field can only ever be `null` in the current codebase, and the type says so
 * structurally rather than leaving a nullable-but-always-null field a future caller could
 * mistake for "sometimes populated." Widening it to a real nullable date is the correct move
 * if/when a genuinely trusted deadline source is ever added — not before.
 */
export const nextActionSchema = z.object({
  type: nextActionTypeSchema,
  priority: nextActionPrioritySchema,
  source: nextActionSourceSchema,
  /** The one real fact this engine ever treats as a date: when the application actually became
   * APPLIED, or null if it never did. Never a deadline; always the original submission moment. */
  appliedAt: isoDateTimeSchema.nullable(),
  /** Derived from appliedAt/now when both are known; null otherwise. Purely observational
   * ("this many days have passed"), never itself a claim that anything is "overdue". Always the
   * real appliedAt fact — never the follow-up anchor below, even when they differ. */
  daysSinceApplied: z.number().int().min(0).nullable(),
  /**
   * The timestamp the follow-up heuristic's threshold check is actually anchored to — `appliedAt`
   * itself, unless a later, meaningful employer-driven status change reset it (e.g. a confirmed
   * `APPLICATION_RECEIVED` transition that arrived well after the original submission). Null
   * whenever `appliedAt` is null; equal to `appliedAt` whenever no later employer activity is
   * known. Deliberately a distinct field from `appliedAt` — `appliedAt` always stays the true
   * original-submission fact, this field is only the follow-up clock's own reference point,
   * which may be later. See next-action-rules.ts's `lastMeaningfulEmployerActivityAt`.
   */
  followUpAnchorAt: isoDateTimeSchema.nullable(),
  /** Days between `followUpAnchorAt` and "now" — what the `CONSIDER_FOLLOW_UP` threshold check
   * and its own "why" text actually use; may differ from `daysSinceApplied` when a later
   * employer signal reset the clock. Null whenever `followUpAnchorAt` is null. */
  daysSinceFollowUpAnchor: z.number().int().min(0).nullable(),
  /** Always null today — see this field's own doc comment above. */
  dueAt: z.null(),
});
export type NextAction = z.infer<typeof nextActionSchema>;
