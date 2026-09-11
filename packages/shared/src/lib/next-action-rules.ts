import type { ApplicationStatus, UnresolvedFieldSummary } from '../schemas/application';
import type {
  NextAction,
  NextActionPriority,
  NextActionSource,
  NextActionType,
} from '../schemas/next-action';

/**
 * Phase 5C.1 — the deterministic next-action engine (docs/IMPLEMENTATION_PLAN.md "Phase 5C.1").
 * Pure, deterministic, no database access, no network access, no Claude — a plain function of
 * its arguments, following the exact same posture as consistency-rules.ts's rule engine. All
 * data assembly (fetching the application row, deciding what "now" is) happens in the caller;
 * this module only ever computes from what it's given.
 *
 * Design finding from inspecting the actual repository before writing this (not assumed):
 * `applications.status` is already the single, fully-reconciled fact by the time it reaches
 * this engine. Every code path that could change it based on an email signal
 * (confirmOwnEmailSignal, the sync pipeline's AUTO_APPLIED case) routes through
 * changeOwnApplicationStatus, which writes `status` directly — a PENDING (unconfirmed)
 * email_signals row never touches `status` at all. This means the engine never needs to
 * separately consult email_signals to decide *which stage* an application is in: `status` alone
 * always answers that. Precedence therefore reduces to a straightforward per-status dispatch —
 * not a multi-signal-fusion problem — because Phase 5B already made `status` the sole reconciled
 * input for that question.
 *
 * That finding does NOT mean `status` alone is sufficient to know *when* the current stage was
 * reached, though (Phase 5C hardening — see docs/IMPLEMENTATION_PLAN.md "Phase 5C hardening —
 * follow-up anchor"): `APPLIED` and `APPLICATION_RECEIVED` share one follow-up branch, and
 * "status is now APPLICATION_RECEIVED" can be true well after the original `appliedAt`. This
 * engine stays exactly as DB-free as ever — it still only ever computes from what it's given —
 * but its caller now supplies one more already-reconciled fact,
 * `lastMeaningfulEmployerActivityAt` (see that field's own doc comment below), assembled from one
 * additional bounded query the caller issues itself.
 */

/**
 * Career OS's own recommendation threshold for suggesting a follow-up — a product heuristic,
 * never an employer fact. No existing product doc specifies one (checked docs/PRODUCT_SPEC.md,
 * docs/USER_FLOWS.md, docs/IMPLEMENTATION_PLAN.md before choosing), so this is a conservative
 * default: long enough that a follow-up email isn't premature (most employers take at least a
 * week to respond to anything), short enough to still be useful. A single named constant, not a
 * magic number inlined at each call site.
 */
export const FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS = 7;

export interface NextActionRuleInput {
  status: ApplicationStatus;
  /** Exactly `applications.unresolvedFields` — null means no autofill/review flow has ever run
   * for this application (never conflated with an empty array, which means the flow ran and
   * found nothing left to resolve). */
  unresolvedFields: UnresolvedFieldSummary[] | null;
  /** Exactly `applications.appliedAt` — the one real fact this engine treats as the original
   * submission date. */
  appliedAt: string | null;
  /**
   * The `createdAt` of the most recent `application_events` row with `eventType:
   * 'STATUS_CHANGE'` for this application, if any is known to the caller — the follow-up
   * heuristic's "has something newer than appliedAt happened to this specific application"
   * signal (Phase 5C hardening; see docs/IMPLEMENTATION_PLAN.md "Phase 5C hardening — follow-up
   * anchor" for the full rationale). Deliberately narrow: because `applications.status` only
   * ever changes via a recorded `STATUS_CHANGE` event (Phase 5B's canonical-transition
   * architecture, and Phase 5B hardening's database-level guard against any other path), the
   * *latest* such event's timestamp is exactly "when did this application's current status get
   * set" — regardless of whether that event's `source` was `USER` or `GMAIL_SYNC`, and
   * regardless of whether it represents a forward move (e.g. into `APPLICATION_RECEIVED`) or a
   * revert. It is never a notes edit, an autofill save, or any other non-`STATUS_CHANGE` event —
   * those never create an `application_events` row at all (confirmed by inspection: `notes`
   * updates go through `updateOwnApplication`'s plain column update, no event). An *unconfirmed*
   * (`PENDING`) `email_signals` row can never influence this either, since only a `CONFIRMED` or
   * `AUTO_APPLIED` signal ever reaches `changeOwnApplicationStatus` in the first place — the one
   * function that creates a `STATUS_CHANGE` event from a Gmail-driven signal. Null when the
   * caller has no such event (a genuinely brand-new application, or a caller that intentionally
   * omits this input) — the engine then falls back to `appliedAt` alone, the same behavior as
   * before this field existed.
   */
  lastMeaningfulEmployerActivityAt: string | null;
  /** Injected, never read internally via `Date.now()`/`new Date()` — keeps this function a pure,
   * deterministically-testable function of its arguments. */
  now: string;
}

function daysBetween(earlierIso: string, laterIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/** The later of a known ISO timestamp and a possibly-null candidate — never null, since `base`
 * itself is always a real timestamp. */
function laterOf(base: string, candidate: string | null): string {
  if (!candidate) return base;
  return new Date(candidate).getTime() > new Date(base).getTime() ? candidate : base;
}

function buildAction(
  type: NextActionType,
  priority: NextActionPriority,
  source: NextActionSource,
  input: NextActionRuleInput,
  followUpAnchorAt: string | null = null,
): NextAction {
  const daysSinceApplied = input.appliedAt
    ? daysBetween(input.appliedAt, input.now)
    : null;
  const daysSinceFollowUpAnchor = followUpAnchorAt
    ? daysBetween(followUpAnchorAt, input.now)
    : null;
  return {
    type,
    priority,
    source,
    appliedAt: input.appliedAt,
    daysSinceApplied,
    followUpAnchorAt,
    daysSinceFollowUpAnchor,
    dueAt: null,
  };
}

/**
 * SAVED/IN_PROGRESS — see docs/IMPLEMENTATION_PLAN.md "Phase 5C.1C" for the full mapping
 * rationale. Unresolved fields always win regardless of which of the two statuses this is:
 * reviewing them is the correct next step whether or not any field has already been approved.
 */
function deriveForUnsubmittedApplication(input: NextActionRuleInput): NextAction {
  const hasUnresolvedFields = (input.unresolvedFields?.length ?? 0) > 0;
  if (hasUnresolvedFields) {
    return buildAction('REVIEW_UNRESOLVED_FIELDS', 'MEDIUM', 'UNRESOLVED_FIELDS', input);
  }
  if (input.status === 'IN_PROGRESS') {
    // At least one field was approved/edited (that's what makes it IN_PROGRESS rather than
    // SAVED — see useApplicationTracker.ts's save() logic) and nothing is left unresolved.
    return buildAction('MARK_APPLIED', 'MEDIUM', 'APPLICATION_STATUS', input);
  }
  // SAVED with no unresolved-field record at all: either a manually-created dashboard
  // application that never touched the extension flow, or an extension run that approved
  // nothing and left nothing unresolved (an empty/unrecognized page). Either way, there's
  // nothing yet to suggest reviewing — the actual next step is starting/continuing the work.
  return buildAction('COMPLETE_APPLICATION', 'LOW', 'APPLICATION_STATUS', input);
}

/**
 * APPLIED/APPLICATION_RECEIVED — see docs/IMPLEMENTATION_PLAN.md "Phase 5C.1F" for the follow-up
 * heuristic's full rationale and its explicit fact-vs-recommendation framing.
 *
 * Phase 5C hardening: the eligibility clock is anchored to
 * `max(appliedAt, lastMeaningfulEmployerActivityAt)`, not `appliedAt` alone. Without this, an
 * application that sat at plain `APPLIED` for 10 days and then received a confirmed
 * `APPLICATION_RECEIVED` update yesterday would immediately suggest following up — even though
 * the employer had just interacted. Anchoring to whichever is later means a fresh employer-
 * driven status change always restarts the "has it been quiet for a while" clock.
 */
function deriveForSubmittedApplication(input: NextActionRuleInput): NextAction {
  if (!input.appliedAt) {
    // Structurally shouldn't happen for anything that went through mark_application_applied
    // (Phase 5B.1 always sets it), but this engine never assumes a fact it can't observe —
    // no appliedAt means no follow-up-timing decision can be made at all.
    return buildAction('NO_ACTION', 'NONE', 'APPLICATION_STATUS', input);
  }
  const anchor = laterOf(input.appliedAt, input.lastMeaningfulEmployerActivityAt);
  const daysSinceAnchor = daysBetween(anchor, input.now);
  if (daysSinceAnchor >= FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS) {
    return buildAction(
      'CONSIDER_FOLLOW_UP',
      'LOW',
      'TIME_SINCE_APPLICATION',
      input,
      anchor,
    );
  }
  return buildAction('NO_ACTION', 'NONE', 'TIME_SINCE_APPLICATION', input, anchor);
}

/**
 * The one entry point. Every `ApplicationStatus` value is handled explicitly (a switch with no
 * default case) so adding a new status to the enum is a compile error here until this function
 * is updated for it, rather than a silent fallthrough.
 */
export function deriveNextAction(input: NextActionRuleInput): NextAction {
  switch (input.status) {
    case 'ACTION_REQUIRED':
      return buildAction('REVIEW_ACTION_REQUIRED', 'URGENT', 'APPLICATION_STATUS', input);
    case 'ASSESSMENT':
      return buildAction('COMPLETE_ASSESSMENT', 'HIGH', 'APPLICATION_STATUS', input);
    case 'INTERVIEW':
      return buildAction('PREPARE_INTERVIEW', 'HIGH', 'APPLICATION_STATUS', input);
    case 'OFFER':
      return buildAction('REVIEW_OFFER', 'URGENT', 'APPLICATION_STATUS', input);
    case 'REJECTED':
    case 'WITHDRAWN':
      // Terminal, closed states — nothing actionable, and never a follow-up suggestion for
      // either (docs/IMPLEMENTATION_PLAN.md "Phase 5C self-review": a rejected/withdrawn
      // application must never receive a follow-up recommendation).
      return buildAction('NO_ACTION', 'NONE', 'APPLICATION_STATUS', input);
    case 'SAVED':
    case 'IN_PROGRESS':
      return deriveForUnsubmittedApplication(input);
    case 'APPLIED':
    case 'APPLICATION_RECEIVED':
      return deriveForSubmittedApplication(input);
    case 'UNKNOWN':
      return buildAction('REVIEW_APPLICATION', 'LOW', 'UNKNOWN_STATUS', input);
  }
}
