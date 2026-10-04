import { describe, expect, it } from 'vitest';
import {
  coerceStats,
  describeApiError,
  isPlausibleLogin,
  rateLimitMessage,
  summarizeSync,
} from './sync-messages';

describe('coerceStats', () => {
  it('defaults every field for junk input', () => {
    const s = coerceStats(null);
    expect(s.reposListed).toBe(0);
    expect(s.rateLimited).toBe(false);
    expect(s.rateLimitResetAt).toBeNull();
  });
  it('keeps valid numbers', () => {
    expect(coerceStats({ reposListed: 4, failed: 'x' }).reposListed).toBe(4);
    expect(coerceStats({ failed: 'x' }).failed).toBe(0);
  });
});

describe('rateLimitMessage', () => {
  it('is null when not limited', () => {
    expect(rateLimitMessage(coerceStats({}))).toBeNull();
  });
  it('includes the reset time when known', () => {
    const msg = rateLimitMessage(
      coerceStats({ rateLimited: true, rateLimitResetAt: '2026-01-02T03:04:05Z' }),
    );
    expect(msg).toContain('2026-01-02 03:04 UTC');
  });
  it('still explains without a reset time', () => {
    expect(rateLimitMessage(coerceStats({ rateLimited: true }))).toMatch(/Try again later/);
  });
});

describe('describeApiError', () => {
  it('prefers the server message', () => {
    expect(describeApiError(400, { error: 'Invalid GitHub connection request' })).toBe(
      'Invalid GitHub connection request',
    );
  });
  it('falls back by status', () => {
    expect(describeApiError(401, {})).toMatch(/signed out/);
    expect(describeApiError(500, null)).toMatch(/Something went wrong/);
  });
});

describe('isPlausibleLogin', () => {
  it('accepts and rejects usernames', () => {
    expect(isPlausibleLogin('octo-cat')).toBe(true);
    expect(isPlausibleLogin('-bad')).toBe(false);
    expect(isPlausibleLogin('a b')).toBe(false);
    expect(isPlausibleLogin('')).toBe(false);
  });
});

describe('summarizeSync', () => {
  it('mentions the counts', () => {
    expect(summarizeSync(coerceStats({ reposListed: 3, failed: 1 }))).toContain('3 listed');
  });
});
