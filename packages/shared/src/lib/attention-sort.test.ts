import { describe, expect, it } from 'vitest';
import {
  compareByAttention,
  sortByAttention,
  type AttentionSortable,
} from './attention-sort';

function item(overrides: Partial<AttentionSortable> = {}): AttentionSortable {
  return {
    id: 'a',
    priority: 'NONE',
    appliedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sortByAttention — priority ordering', () => {
  it('orders URGENT, HIGH, MEDIUM, LOW, NONE strictly in that order', () => {
    const items = [
      item({ id: 'none', priority: 'NONE' }),
      item({ id: 'low', priority: 'LOW' }),
      item({ id: 'urgent', priority: 'URGENT' }),
      item({ id: 'medium', priority: 'MEDIUM' }),
      item({ id: 'high', priority: 'HIGH' }),
    ];
    const sorted = sortByAttention(items).map((i) => i.id);
    expect(sorted).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
  });

  it('does not mutate the input array', () => {
    const items = [
      item({ id: 'a', priority: 'LOW' }),
      item({ id: 'b', priority: 'URGENT' }),
    ];
    const original = [...items];
    sortByAttention(items);
    expect(items).toEqual(original);
  });
});

describe('sortByAttention — tie-break within the same priority', () => {
  it('sorts by appliedAt ascending (longer-waiting first) when both items have one', () => {
    const older = item({
      id: 'older',
      priority: 'URGENT',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = item({
      id: 'newer',
      priority: 'URGENT',
      appliedAt: '2026-02-01T00:00:00.000Z',
    });
    const sorted = sortByAttention([newer, older]).map((i) => i.id);
    expect(sorted).toEqual(['older', 'newer']);
  });

  it('falls back to updatedAt descending (most recently touched first) when appliedAt is missing on either side', () => {
    const stale = item({
      id: 'stale',
      priority: 'LOW',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const fresh = item({
      id: 'fresh',
      priority: 'LOW',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    const sorted = sortByAttention([stale, fresh]).map((i) => i.id);
    expect(sorted).toEqual(['fresh', 'stale']);
  });

  it('falls back to updatedAt when only one side has appliedAt (never both-null-both-real mixed silently)', () => {
    const withApplied = item({
      id: 'applied',
      priority: 'LOW',
      appliedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const withoutApplied = item({
      id: 'never-applied',
      priority: 'LOW',
      appliedAt: null,
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    // withoutApplied has a more recent updatedAt, so it sorts first under the fallback rule.
    const sorted = sortByAttention([withApplied, withoutApplied]).map((i) => i.id);
    expect(sorted).toEqual(['never-applied', 'applied']);
  });

  it('breaks an exact tie deterministically by id', () => {
    const a = item({ id: 'a', priority: 'LOW', updatedAt: '2026-01-01T00:00:00.000Z' });
    const b = item({ id: 'b', priority: 'LOW', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(sortByAttention([b, a]).map((i) => i.id)).toEqual(['a', 'b']);
    expect(compareByAttention(a, b)).toBeLessThan(0);
    expect(compareByAttention(b, a)).toBeGreaterThan(0);
  });
});

describe('sortByAttention — stability across repeated calls', () => {
  it('produces the exact same order every time for the same input (deterministic)', () => {
    const items = [
      item({ id: 'a', priority: 'HIGH', updatedAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'b', priority: 'URGENT', appliedAt: '2026-01-05T00:00:00.000Z' }),
      item({ id: 'c', priority: 'URGENT', appliedAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'd', priority: 'NONE' }),
    ];
    const first = sortByAttention(items).map((i) => i.id);
    const second = sortByAttention(items).map((i) => i.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['c', 'b', 'a', 'd']);
  });
});
