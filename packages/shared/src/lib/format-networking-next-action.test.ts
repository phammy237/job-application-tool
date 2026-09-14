import { describe, expect, it } from 'vitest';
import { formatNetworkingNextAction } from './format-networking-next-action';

describe('formatNetworkingNextAction', () => {
  it('formats FOLLOW_UP_WITH_CONTACT with factual, non-judgmental copy', () => {
    const result = formatNetworkingNextAction({
      type: 'FOLLOW_UP_WITH_CONTACT',
      priority: 'MEDIUM',
      source: 'EXPLICIT_FOLLOW_UP_REMINDER',
      followUpAt: '2026-06-14T12:00:00.000Z',
    });
    expect(result.title).toBe('Follow up');
    expect(result.reason).toContain('You set a reminder');
  });

  it('never uses judgmental language like "neglected" or "overdue"', () => {
    const result = formatNetworkingNextAction({
      type: 'FOLLOW_UP_WITH_CONTACT',
      priority: 'MEDIUM',
      source: 'EXPLICIT_FOLLOW_UP_REMINDER',
      followUpAt: '2026-06-14T12:00:00.000Z',
    });
    expect(result.reason.toLowerCase()).not.toMatch(/neglect|overdue|should have|late/);
  });

  it('formats NO_ACTION with no reminder set', () => {
    const result = formatNetworkingNextAction({
      type: 'NO_ACTION',
      priority: 'NONE',
      source: 'EXPLICIT_FOLLOW_UP_REMINDER',
      followUpAt: null,
    });
    expect(result.title).toBe('No action needed');
    expect(result.reason).toBe('No follow-up reminder is set for this contact.');
  });

  it('formats NO_ACTION with a future reminder distinctly from no reminder at all', () => {
    const result = formatNetworkingNextAction({
      type: 'NO_ACTION',
      priority: 'NONE',
      source: 'EXPLICIT_FOLLOW_UP_REMINDER',
      followUpAt: '2026-06-20T12:00:00.000Z',
    });
    expect(result.reason).toBe('Your follow-up reminder for this contact is not due yet.');
  });

  it('never embeds a formatted calendar date string (that is the caller’s responsibility)', () => {
    const result = formatNetworkingNextAction({
      type: 'FOLLOW_UP_WITH_CONTACT',
      priority: 'MEDIUM',
      source: 'EXPLICIT_FOLLOW_UP_REMINDER',
      followUpAt: '2026-06-14T12:00:00.000Z',
    });
    // No raw ISO fragment or month name leaking into the formatter's own prose.
    expect(result.reason).not.toMatch(/2026|Jun/);
  });
});
