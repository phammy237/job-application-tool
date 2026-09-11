import { describe, expect, it } from 'vitest';
import type { UnresolvedFieldSummary } from '../schemas/application';
import {
  FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS,
  deriveNextAction,
  type NextActionRuleInput,
} from './next-action-rules';

const NOW = '2026-06-15T00:00:00.000Z';

function input(overrides: Partial<NextActionRuleInput> = {}): NextActionRuleInput {
  return {
    status: 'SAVED',
    unresolvedFields: null,
    appliedAt: null,
    lastMeaningfulEmployerActivityAt: null,
    now: NOW,
    ...overrides,
  };
}

function unresolved(
  overrides: Partial<UnresolvedFieldSummary> = {},
): UnresolvedFieldSummary {
  return {
    label: 'Some field',
    classification: 'FREE_RESPONSE',
    status: 'NEEDS_INPUT',
    reason: 'No suggestion available',
    ...overrides,
  };
}

function daysAgoIso(days: number, fromIso: string = NOW): string {
  return new Date(new Date(fromIso).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ================================================================================================
// Table-driven coverage — every status, per Phase 5C.1J
// ================================================================================================

describe('deriveNextAction — one case per status', () => {
  it.each([
    ['SAVED', 'COMPLETE_APPLICATION', 'LOW'],
    ['IN_PROGRESS', 'MARK_APPLIED', 'MEDIUM'],
    ['APPLICATION_RECEIVED', 'NO_ACTION', 'NONE'],
    ['ACTION_REQUIRED', 'REVIEW_ACTION_REQUIRED', 'URGENT'],
    ['ASSESSMENT', 'COMPLETE_ASSESSMENT', 'HIGH'],
    ['INTERVIEW', 'PREPARE_INTERVIEW', 'HIGH'],
    ['OFFER', 'REVIEW_OFFER', 'URGENT'],
    ['REJECTED', 'NO_ACTION', 'NONE'],
    ['WITHDRAWN', 'NO_ACTION', 'NONE'],
    ['UNKNOWN', 'REVIEW_APPLICATION', 'LOW'],
  ] as const)('%s -> %s (%s)', (status, expectedType, expectedPriority) => {
    const result = deriveNextAction(
      input({
        status,
        appliedAt: status === 'APPLICATION_RECEIVED' ? daysAgoIso(1) : null,
      }),
    );
    expect(result.type).toBe(expectedType);
    expect(result.priority).toBe(expectedPriority);
  });

  it('APPLIED with no unresolved follow-up yet is NO_ACTION', () => {
    const result = deriveNextAction(
      input({ status: 'APPLIED', appliedAt: daysAgoIso(1) }),
    );
    expect(result.type).toBe('NO_ACTION');
    expect(result.priority).toBe('NONE');
  });
});

// ================================================================================================
// SAVED/IN_PROGRESS — unresolved-field override (Phase 5C.1D)
// ================================================================================================

describe('deriveNextAction — unresolved-field override', () => {
  it('SAVED with unresolved fields -> REVIEW_UNRESOLVED_FIELDS, not COMPLETE_APPLICATION', () => {
    const result = deriveNextAction(
      input({ status: 'SAVED', unresolvedFields: [unresolved()] }),
    );
    expect(result.type).toBe('REVIEW_UNRESOLVED_FIELDS');
    expect(result.priority).toBe('MEDIUM');
  });

  it('IN_PROGRESS with unresolved fields -> REVIEW_UNRESOLVED_FIELDS, never MARK_APPLIED (unresolved fields outrank mark-applied)', () => {
    const result = deriveNextAction(
      input({ status: 'IN_PROGRESS', unresolvedFields: [unresolved()] }),
    );
    expect(result.type).toBe('REVIEW_UNRESOLVED_FIELDS');
  });

  it('IN_PROGRESS with an empty (not null) unresolvedFields array -> MARK_APPLIED', () => {
    const result = deriveNextAction(
      input({ status: 'IN_PROGRESS', unresolvedFields: [] }),
    );
    expect(result.type).toBe('MARK_APPLIED');
  });

  it('SAVED with an empty (not null) unresolvedFields array -> COMPLETE_APPLICATION, not MARK_APPLIED (no approved work happened)', () => {
    const result = deriveNextAction(input({ status: 'SAVED', unresolvedFields: [] }));
    expect(result.type).toBe('COMPLETE_APPLICATION');
  });

  it('SAVED with unresolvedFields null (never ran the extension flow) -> COMPLETE_APPLICATION', () => {
    const result = deriveNextAction(input({ status: 'SAVED', unresolvedFields: null }));
    expect(result.type).toBe('COMPLETE_APPLICATION');
  });
});

// ================================================================================================
// Follow-up heuristic — boundary behavior (Phase 5C.1F)
// ================================================================================================

describe('deriveNextAction — CONSIDER_FOLLOW_UP threshold boundary', () => {
  it(`exactly ${FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS} days since applied fires the suggestion`, () => {
    const result = deriveNextAction(
      input({
        status: 'APPLIED',
        appliedAt: daysAgoIso(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS),
      }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.priority).toBe('LOW');
    expect(result.daysSinceApplied).toBe(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS);
  });

  it(`one millisecond short of ${FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS} days does not fire`, () => {
    const appliedAt = new Date(
      new Date(NOW).getTime() -
        FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS * 24 * 60 * 60 * 1000 +
        1,
    ).toISOString();
    const result = deriveNextAction(input({ status: 'APPLIED', appliedAt }));
    expect(result.type).toBe('NO_ACTION');
    expect(result.daysSinceApplied).toBe(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS - 1);
  });

  it('well past the threshold still fires (no upper bound / no "overdue" escalation)', () => {
    const result = deriveNextAction(
      input({ status: 'APPLIED', appliedAt: daysAgoIso(60) }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.priority).toBe('LOW');
  });

  it('APPLICATION_RECEIVED also uses the same threshold, counted from the original appliedAt', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLICATION_RECEIVED',
        appliedAt: daysAgoIso(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS),
      }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
  });

  it('never fires for a status where appliedAt is null (no real fact to reason from)', () => {
    const result = deriveNextAction(input({ status: 'APPLIED', appliedAt: null }));
    expect(result.type).toBe('NO_ACTION');
    expect(result.daysSinceApplied).toBeNull();
  });
});

// ================================================================================================
// Precedence — explicit assertions per Phase 5C.1B/5C.1J
// ================================================================================================

describe('deriveNextAction — precedence', () => {
  it('REJECTED never produces a follow-up suggestion, no matter how long ago it was applied', () => {
    const result = deriveNextAction(
      input({ status: 'REJECTED', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('NO_ACTION');
  });

  it('WITHDRAWN never produces a follow-up suggestion either', () => {
    const result = deriveNextAction(
      input({ status: 'WITHDRAWN', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('NO_ACTION');
  });

  it('ACTION_REQUIRED outranks everything else — it is a distinct status, so a follow-up computation never even runs for it', () => {
    const result = deriveNextAction(
      input({ status: 'ACTION_REQUIRED', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('REVIEW_ACTION_REQUIRED');
    expect(result.priority).toBe('URGENT');
  });

  it('ASSESSMENT outranks follow-up the same way', () => {
    const result = deriveNextAction(
      input({ status: 'ASSESSMENT', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('COMPLETE_ASSESSMENT');
  });

  it('INTERVIEW outranks follow-up the same way', () => {
    const result = deriveNextAction(
      input({ status: 'INTERVIEW', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('PREPARE_INTERVIEW');
  });

  it('OFFER outranks every lower-priority action', () => {
    const result = deriveNextAction(
      input({ status: 'OFFER', appliedAt: daysAgoIso(90) }),
    );
    expect(result.type).toBe('REVIEW_OFFER');
    expect(result.priority).toBe('URGENT');
  });

  it('unresolved fields outrank MARK_APPLIED for an IN_PROGRESS application', () => {
    const result = deriveNextAction(
      input({ status: 'IN_PROGRESS', unresolvedFields: [unresolved()] }),
    );
    expect(result.type).toBe('REVIEW_UNRESOLVED_FIELDS');
    expect(result.type).not.toBe('MARK_APPLIED');
  });
});

// ================================================================================================
// Safety with missing/malformed historical data
// ================================================================================================

describe('deriveNextAction — missing/malformed data never throws or guesses', () => {
  it('handles every status with appliedAt null and unresolvedFields null without throwing', () => {
    const statuses = [
      'SAVED',
      'IN_PROGRESS',
      'APPLIED',
      'APPLICATION_RECEIVED',
      'ASSESSMENT',
      'INTERVIEW',
      'ACTION_REQUIRED',
      'OFFER',
      'REJECTED',
      'WITHDRAWN',
      'UNKNOWN',
    ] as const;
    for (const status of statuses) {
      expect(() => deriveNextAction(input({ status }))).not.toThrow();
    }
  });

  it('never returns a non-null dueAt — no code path in this engine can produce one', () => {
    const result = deriveNextAction(input({ status: 'OFFER' }));
    expect(result.dueAt).toBeNull();
  });

  it('daysSinceApplied is always null when appliedAt is null, regardless of status', () => {
    const result = deriveNextAction(
      input({ status: 'APPLICATION_RECEIVED', appliedAt: null }),
    );
    expect(result.daysSinceApplied).toBeNull();
  });
});

// ================================================================================================
// Follow-up anchor — accounting for a later meaningful employer interaction (Phase 5C hardening).
// See docs/IMPLEMENTATION_PLAN.md "Phase 5C hardening — follow-up anchor" for the full rationale:
// appliedAt alone is not sufficient once a confirmed employer-driven status change (e.g. into
// APPLICATION_RECEIVED) happens well after the original submission — the clock must restart from
// whichever is later.
// ================================================================================================

describe('deriveNextAction — follow-up anchor accounts for a later employer interaction', () => {
  // A. applied 6 days ago, no employer activity -> no follow-up.
  it('A: 6 days since applied, no employer activity -> NO_ACTION', () => {
    const result = deriveNextAction(
      input({ status: 'APPLIED', appliedAt: daysAgoIso(6) }),
    );
    expect(result.type).toBe('NO_ACTION');
  });

  // B. applied exactly 7 days ago, no employer activity -> confirms the documented boundary.
  it('B: exactly 7 days since applied, no employer activity -> CONSIDER_FOLLOW_UP (documented boundary)', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLIED',
        appliedAt: daysAgoIso(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS),
      }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.daysSinceFollowUpAnchor).toBe(FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS);
  });

  // C. applied 10 days ago, no employer activity -> follow-up.
  it('C: 10 days since applied, no employer activity -> CONSIDER_FOLLOW_UP', () => {
    const result = deriveNextAction(
      input({ status: 'APPLIED', appliedAt: daysAgoIso(10) }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.followUpAnchorAt).toBe(daysAgoIso(10));
  });

  // D. applied 10 days ago, meaningful employer interaction yesterday -> NO follow-up.
  it('D: applied 10 days ago, meaningful employer interaction yesterday -> NO_ACTION, not CONSIDER_FOLLOW_UP', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLICATION_RECEIVED',
        appliedAt: daysAgoIso(10),
        lastMeaningfulEmployerActivityAt: daysAgoIso(1),
      }),
    );
    expect(result.type).toBe('NO_ACTION');
    expect(result.followUpAnchorAt).toBe(daysAgoIso(1));
    expect(result.daysSinceFollowUpAnchor).toBe(1);
  });

  // E. applied 10 days ago, meaningful employer interaction 8 days ago -> follow-up eligible
  // again (the employer activity itself is now old enough).
  it('E: applied 10 days ago, meaningful employer interaction 8 days ago -> CONSIDER_FOLLOW_UP, anchored to the employer activity', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLICATION_RECEIVED',
        appliedAt: daysAgoIso(10),
        lastMeaningfulEmployerActivityAt: daysAgoIso(8),
      }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.followUpAnchorAt).toBe(daysAgoIso(8));
    expect(result.daysSinceFollowUpAnchor).toBe(8);
  });

  // F. APPLICATION_RECEIVED yesterday from a 10-day-old application -> no immediate follow-up.
  it('F: APPLICATION_RECEIVED yesterday on a 10-day-old application -> no immediate follow-up', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLICATION_RECEIVED',
        appliedAt: daysAgoIso(10),
        lastMeaningfulEmployerActivityAt: daysAgoIso(1),
      }),
    );
    expect(result.type).not.toBe('CONSIDER_FOLLOW_UP');
    expect(result.type).toBe('NO_ACTION');
  });

  // G. An unconfirmed/ambiguous Gmail signal structurally cannot reach this engine at all (only
  // a CONFIRMED/AUTO_APPLIED signal ever calls changeOwnApplicationStatus, the one function that
  // creates a STATUS_CHANGE event) — so the caller-supplied lastMeaningfulEmployerActivityAt is
  // simply null in that case, and the engine correctly falls back to appliedAt alone.
  it('G: no employer-activity input supplied (as for an unconfirmed signal, which never produces one) -> falls back to appliedAt alone', () => {
    const withNoAnchorInput = deriveNextAction(
      input({
        status: 'APPLIED',
        appliedAt: daysAgoIso(10),
        lastMeaningfulEmployerActivityAt: null,
      }),
    );
    const withExplicitAppliedAtOnly = deriveNextAction(
      input({ status: 'APPLIED', appliedAt: daysAgoIso(10) }),
    );
    expect(withNoAnchorInput).toEqual(withExplicitAppliedAtOnly);
    expect(withNoAnchorInput.type).toBe('CONSIDER_FOLLOW_UP');
    expect(withNoAnchorInput.followUpAnchorAt).toBe(daysAgoIso(10));
  });

  // H. A user-only application edit (e.g. notes) never creates a STATUS_CHANGE event at all
  // (verified by inspection: updateOwnApplication only updates columns, never calls
  // recordApplicationEvent) — so it can never even be assembled into
  // lastMeaningfulEmployerActivityAt in the first place. At the pure-engine level this means
  // supplying a stale/absent anchor still correctly falls back to appliedAt, never masquerading
  // as employer activity.
  it('H: a merely-old/absent employer-activity input never masquerades as recent employer activity', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLIED',
        appliedAt: daysAgoIso(10),
        // Deliberately not "yesterday" — nothing in this engine's input construction can put a
        // non-STATUS_CHANGE fact (like a notes edit) into this field; this asserts the pure
        // fallback behavior when it is absent, which is what a notes-only edit always produces.
        lastMeaningfulEmployerActivityAt: null,
      }),
    );
    expect(result.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result.followUpAnchorAt).toBe(daysAgoIso(10));
  });

  // I. ASSESSMENT/INTERVIEW/ACTION_REQUIRED/OFFER/REJECTED/WITHDRAWN are never replaced by the
  // follow-up heuristic, even with a very recent "employer activity" input supplied — the
  // follow-up branch is structurally unreachable for any of these statuses.
  it.each([
    ['ASSESSMENT', 'COMPLETE_ASSESSMENT'],
    ['INTERVIEW', 'PREPARE_INTERVIEW'],
    ['ACTION_REQUIRED', 'REVIEW_ACTION_REQUIRED'],
    ['OFFER', 'REVIEW_OFFER'],
    ['REJECTED', 'NO_ACTION'],
    ['WITHDRAWN', 'NO_ACTION'],
  ] as const)('I: %s is never replaced by CONSIDER_FOLLOW_UP', (status, expectedType) => {
    const result = deriveNextAction(
      input({
        status,
        appliedAt: daysAgoIso(30),
        lastMeaningfulEmployerActivityAt: daysAgoIso(1),
      }),
    );
    expect(result.type).toBe(expectedType);
    expect(result.type).not.toBe('CONSIDER_FOLLOW_UP');
  });

  it('the follow-up anchor never affects daysSinceApplied — that field always reflects the real appliedAt fact', () => {
    const result = deriveNextAction(
      input({
        status: 'APPLICATION_RECEIVED',
        appliedAt: daysAgoIso(10),
        lastMeaningfulEmployerActivityAt: daysAgoIso(1),
      }),
    );
    expect(result.daysSinceApplied).toBe(10);
    expect(result.daysSinceFollowUpAnchor).toBe(1);
  });
});
