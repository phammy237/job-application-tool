import { describe, expect, it } from 'vitest';
import { deriveNetworkingNextAction } from './networking-next-action-rules';

const NOW = '2026-06-15T12:00:00.000Z';

describe('deriveNetworkingNextAction', () => {
  it('returns NO_ACTION when no reminder is set (followUpAt is null)', () => {
    const action = deriveNetworkingNextAction({ followUpAt: null, now: NOW });
    expect(action.type).toBe('NO_ACTION');
    expect(action.priority).toBe('NONE');
    expect(action.followUpAt).toBeNull();
  });

  it('returns NO_ACTION for a reminder set in the future', () => {
    const action = deriveNetworkingNextAction({
      followUpAt: '2026-06-16T12:00:00.000Z',
      now: NOW,
    });
    expect(action.type).toBe('NO_ACTION');
    expect(action.priority).toBe('NONE');
  });

  it('returns FOLLOW_UP_WITH_CONTACT when the reminder is exactly now', () => {
    const action = deriveNetworkingNextAction({ followUpAt: NOW, now: NOW });
    expect(action.type).toBe('FOLLOW_UP_WITH_CONTACT');
  });

  it('returns FOLLOW_UP_WITH_CONTACT for a reminder in the past', () => {
    const action = deriveNetworkingNextAction({
      followUpAt: '2026-06-14T12:00:00.000Z',
      now: NOW,
    });
    expect(action.type).toBe('FOLLOW_UP_WITH_CONTACT');
  });

  it('sets priority MEDIUM when a follow-up is due, never URGENT or HIGH', () => {
    const action = deriveNetworkingNextAction({
      followUpAt: '2026-06-14T12:00:00.000Z',
      now: NOW,
    });
    expect(action.priority).toBe('MEDIUM');
  });

  it('sets source EXPLICIT_FOLLOW_UP_REMINDER regardless of outcome', () => {
    expect(deriveNetworkingNextAction({ followUpAt: null, now: NOW }).source).toBe(
      'EXPLICIT_FOLLOW_UP_REMINDER',
    );
    expect(
      deriveNetworkingNextAction({ followUpAt: '2026-06-14T12:00:00.000Z', now: NOW }).source,
    ).toBe('EXPLICIT_FOLLOW_UP_REMINDER');
  });

  it('carries the raw followUpAt fact through unchanged, whether due or not', () => {
    const future = deriveNetworkingNextAction({
      followUpAt: '2026-06-16T12:00:00.000Z',
      now: NOW,
    });
    expect(future.followUpAt).toBe('2026-06-16T12:00:00.000Z');

    const past = deriveNetworkingNextAction({
      followUpAt: '2026-06-14T12:00:00.000Z',
      now: NOW,
    });
    expect(past.followUpAt).toBe('2026-06-14T12:00:00.000Z');
  });

  it('is stable at a one-millisecond boundary around "now"', () => {
    const oneMsBefore = deriveNetworkingNextAction({
      followUpAt: '2026-06-15T11:59:59.999Z',
      now: NOW,
    });
    expect(oneMsBefore.type).toBe('FOLLOW_UP_WITH_CONTACT');

    const oneMsAfter = deriveNetworkingNextAction({
      followUpAt: '2026-06-15T12:00:00.001Z',
      now: NOW,
    });
    expect(oneMsAfter.type).toBe('NO_ACTION');
  });

  it('never returns URGENT or HIGH priority for any input', () => {
    const inputs = [null, '2026-06-14T12:00:00.000Z', '2026-06-16T12:00:00.000Z', NOW];
    for (const followUpAt of inputs) {
      const action = deriveNetworkingNextAction({ followUpAt, now: NOW });
      expect(action.priority).not.toBe('URGENT');
      expect(action.priority).not.toBe('HIGH');
    }
  });
});
