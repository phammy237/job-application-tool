import { describe, expect, it } from 'vitest';
import { computeObservedFreshness } from './observed-freshness';

const NOW = new Date('2026-01-31T00:00:00.000Z');

describe('computeObservedFreshness', () => {
  it('buckets <= 2 days as NEW', () => {
    expect(computeObservedFreshness('2026-01-30T00:00:00.000Z', NOW).bucket).toBe('NEW');
    expect(computeObservedFreshness('2026-01-29T00:00:00.000Z', NOW).bucket).toBe('NEW');
  });

  it('buckets <= 7 days as RECENT', () => {
    expect(computeObservedFreshness('2026-01-25T00:00:00.000Z', NOW).bucket).toBe('RECENT');
  });

  it('buckets <= 30 days as MODERATE', () => {
    expect(computeObservedFreshness('2026-01-05T00:00:00.000Z', NOW).bucket).toBe('MODERATE');
  });

  it('buckets older-but-active as ESTABLISHED with a small positive fit, not zero', () => {
    const result = computeObservedFreshness('2009-12-05T00:00:00.000Z', NOW);
    expect(result.bucket).toBe('ESTABLISHED');
    expect(result.fit).toBeGreaterThan(0);
    expect(result.fit).toBeLessThan(0.5);
  });

  it('fit values are monotonically decreasing with age', () => {
    const newFit = computeObservedFreshness('2026-01-30T00:00:00.000Z', NOW).fit;
    const recentFit = computeObservedFreshness('2026-01-25T00:00:00.000Z', NOW).fit;
    const moderateFit = computeObservedFreshness('2026-01-05T00:00:00.000Z', NOW).fit;
    const establishedFit = computeObservedFreshness('2020-01-01T00:00:00.000Z', NOW).fit;
    expect(newFit).toBeGreaterThan(recentFit);
    expect(recentFit).toBeGreaterThan(moderateFit);
    expect(moderateFit).toBeGreaterThan(establishedFit);
  });

  it('never produces a negative days-since value for a future timestamp', () => {
    const result = computeObservedFreshness('2026-02-15T00:00:00.000Z', NOW);
    expect(result.daysSinceFirstSeen).toBeGreaterThanOrEqual(0);
  });
});
