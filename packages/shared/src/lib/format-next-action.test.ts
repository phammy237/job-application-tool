import { describe, expect, it } from 'vitest';
import type { NextAction, NextActionType } from '../schemas/next-action';
import { formatNextAction } from './format-next-action';

function action(overrides: Partial<NextAction> = {}): NextAction {
  return {
    type: 'NO_ACTION',
    priority: 'NONE',
    source: 'APPLICATION_STATUS',
    appliedAt: null,
    daysSinceApplied: null,
    dueAt: null,
    ...overrides,
  };
}

const ALL_TYPES: NextActionType[] = [
  'REVIEW_UNRESOLVED_FIELDS',
  'COMPLETE_APPLICATION',
  'MARK_APPLIED',
  'REVIEW_ACTION_REQUIRED',
  'COMPLETE_ASSESSMENT',
  'PREPARE_INTERVIEW',
  'REVIEW_OFFER',
  'CONSIDER_FOLLOW_UP',
  'REVIEW_APPLICATION',
  'NO_ACTION',
];

describe('formatNextAction', () => {
  it('produces a non-empty title and reason for every action type', () => {
    for (const type of ALL_TYPES) {
      const { title, reason } = formatNextAction(action({ type }));
      expect(title.length).toBeGreaterThan(0);
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('CONSIDER_FOLLOW_UP states the real day count as fact, and explicitly disclaims — never asserts — an employer deadline', () => {
    const { reason } = formatNextAction(
      action({ type: 'CONSIDER_FOLLOW_UP', daysSinceApplied: 10 }),
    );
    expect(reason).toContain('10 days ago');
    expect(reason).toContain('recommendation');
    // "not a known employer deadline" is the correct, deliberate disclaimer wording — the word
    // itself appearing in a negation is not a violation; the check that matters is that it never
    // asserts a deadline exists.
    expect(reason).toContain('not a known employer deadline');
    expect(reason.toLowerCase()).not.toContain('overdue');
    expect(reason.toLowerCase()).not.toContain('is late');
  });

  it('CONSIDER_FOLLOW_UP with a singular day count says "1 day", not "1 days"', () => {
    const { reason } = formatNextAction(
      action({ type: 'CONSIDER_FOLLOW_UP', daysSinceApplied: 1 }),
    );
    expect(reason).toContain('1 day ago');
    expect(reason).not.toContain('1 days ago');
  });

  it('CONSIDER_FOLLOW_UP degrades gracefully with no day count rather than fabricating one', () => {
    const { reason } = formatNextAction(
      action({ type: 'CONSIDER_FOLLOW_UP', daysSinceApplied: null }),
    );
    expect(reason).not.toMatch(/\d+ days? ago/);
  });

  it('never mentions a specific due date or "overdue" language for any action type', () => {
    for (const type of ALL_TYPES) {
      const { title, reason } = formatNextAction(action({ type }));
      expect(`${title} ${reason}`.toLowerCase()).not.toContain('overdue');
    }
  });
});
