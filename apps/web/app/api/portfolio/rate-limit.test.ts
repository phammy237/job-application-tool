import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimits } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(resetRateLimits);

  it('allows up to the limit then blocks until the window resets', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('a', 3, 1000, 0).allowed).toBe(true);
    const blocked = checkRateLimit('a', 3, 1000, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(checkRateLimit('a', 3, 1000, 1001).allowed).toBe(true);
  });

  it('tracks ids independently', () => {
    checkRateLimit('a', 1, 1000, 0);
    expect(checkRateLimit('a', 1, 1000, 1).allowed).toBe(false);
    expect(checkRateLimit('b', 1, 1000, 1).allowed).toBe(true);
  });
});
