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
 * email_signals row never touches `status` at all. This means the engine does not need to
 * separately consult email_signals or application_events to decide what to recommend: if
 * `status` is still exactly `APPLIED`, that alone proves no employer-classified signal has
 * been confirmed since the original transition, which is exactly what the follow-up heuristic
 * needs to know. Precedence therefore reduces to a straightforward per-status dispatch — not a
 * multi-signal-fusion problem — because Phase 5B already made `status` the sole reconciled
 * input. See docs/IMPLEMENTATION_PLAN.md "Phase 5C.1" for the full rationale, including why this
 * means Phase 5C.1 adds no new database query for correctness.
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
  /** Exactly `applications.appliedAt` — the one real fact this engine treats as a date. */
  appliedAt: string | null;
  /** Injected, never read internally via `Date.now()`/`new Date()` — keeps this function a pure,
   * deterministically-testable function of its arguments. */
  now: string;
}

function daysBetween(earlierIso: string, laterIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function buildAction(
  type: NextActionType,
  priority: NextActionPriority,
  source: NextActionSource,
  input: NextActionRuleInput,
): NextAction {
  const daysSinceApplied = input.appliedAt
    ? daysBetween(input.appliedAt, input.now)
    : null;
  return {
    type,
    priority,
    source,
    appliedAt: input.appliedAt,
    daysSinceApplied,
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
 */
function deriveForSubmittedApplication(input: NextActionRuleInput): NextAction {
  if (!input.appliedAt) {
    // Structurally shouldn't happen for anything that went through mark_application_applied
    // (Phase 5B.1 always sets it), but this engine never assumes a fact it can't observe —
    // no appliedAt means no follow-up-timing decision can be made at all.
    return buildAction('NO_ACTION', 'NONE', 'APPLICATION_STATUS', input);
  }
  const daysSinceApplied = daysBetween(input.appliedAt, input.now);
  if (daysSinceApplied >= FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS) {
    return buildAction('CONSIDER_FOLLOW_UP', 'LOW', 'TIME_SINCE_APPLICATION', input);
  }
  return buildAction('NO_ACTION', 'NONE', 'TIME_SINCE_APPLICATION', input);
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
