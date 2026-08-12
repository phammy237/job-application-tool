import { describe, expect, it } from 'vitest';
import { isCurrentRequest, startRequest } from './request-correlation';

describe('startRequest', () => {
  it('produces a fresh, distinct id on every call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => startRequest()));
    expect(ids.size).toBe(20);
  });
});

describe('isCurrentRequest', () => {
  it('accepts a normal, matching response', () => {
    const pending = startRequest();
    expect(isCurrentRequest(pending, pending)).toBe(true);
  });

  it('rejects when nothing is currently pending (idle)', () => {
    const incoming = startRequest();
    expect(isCurrentRequest(null, incoming)).toBe(false);
  });

  it('rejects a stale response after a newer request superseded it — the exact cross-tab/late-response bug this exists to prevent', () => {
    const firstRequestId = startRequest();
    // A second operation starts (e.g. the user re-analyzed, or triggered autofill again)
    // before the first one's response arrives — this is the currently pending request now.
    const secondRequestId = startRequest();

    // The FIRST request's response finally arrives, late.
    expect(isCurrentRequest(secondRequestId, firstRequestId)).toBe(false);
    // The second (current) request's response is still correctly accepted.
    expect(isCurrentRequest(secondRequestId, secondRequestId)).toBe(true);
  });

  it('rejects a response whose id was never issued as the pending request at all — e.g. a broadcast from another tab or a previous popup instance', () => {
    const pending = startRequest();
    const unrelatedId = startRequest(); // simulates some other operation's own id
    expect(isCurrentRequest(pending, unrelatedId)).toBe(false);
  });

  it('handles many simultaneous/rapid requests — only the very last one started is ever accepted', () => {
    const requestIds = Array.from({ length: 10 }, () => startRequest());
    const current = requestIds[requestIds.length - 1]!;

    for (const id of requestIds) {
      const shouldAccept = id === current;
      expect(isCurrentRequest(current, id)).toBe(shouldAccept);
    }
  });
});
