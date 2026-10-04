import type { TimelineEntry } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  availableYears,
  formatRange,
  groupByYear,
  parseTimelineParams,
  resolveEntryHref,
  timelineHref,
} from './helpers';

const NOW = new Date('2026-06-15T00:00:00Z');

function entry(over: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: 'PROJECT:p1',
    type: 'PROJECT',
    title: 'T',
    subtitle: null,
    start: null,
    end: null,
    isOngoing: false,
    relatedSkillNames: [],
    evidenceCount: 0,
    verificationState: 'USER_PROVIDED',
    href: '/my/projects/p1',
    ...over,
  };
}

describe('parseTimelineParams', () => {
  it('accepts valid values and rejects junk', () => {
    expect(parseTimelineParams({ type: 'WORK', year: '2024' })).toEqual({
      type: 'WORK',
      year: 2024,
      skillId: null,
    });
    expect(parseTimelineParams({ type: 'nope', year: 'abc', skill: 'x' })).toEqual({
      type: null,
      year: null,
      skillId: null,
    });
  });
});

describe('timelineHref', () => {
  it('overrides and clears filters', () => {
    const cur = { type: 'WORK' as const, year: 2024, skillId: null };
    expect(timelineHref(cur, { type: null })).toBe('/my/timeline?year=2024');
    expect(timelineHref(cur, { year: null, type: null })).toBe('/my/timeline');
    expect(timelineHref(cur, { type: 'AWARD' })).toBe('/my/timeline?type=AWARD&year=2024');
  });
});

describe('resolveEntryHref', () => {
  it('points achievements at their anchor and keeps other hrefs', () => {
    expect(resolveEntryHref(entry({ id: 'ACHIEVEMENT:abc', href: '/my/achievements' }))).toBe(
      '/my/achievements#a-abc',
    );
    expect(resolveEntryHref(entry({}))).toBe('/my/projects/p1');
  });
});

describe('formatRange', () => {
  it('uses Present for ongoing entries', () => {
    expect(formatRange({ start: '2023-04-01', end: null, isOngoing: true })).toBe('2023-04 – Present');
    expect(formatRange({ start: '2021-01-01', end: '2022-06-30', isOngoing: false })).toBe(
      '2021-01 – 2022-06',
    );
    expect(formatRange({ start: '2020-05-01', end: null, isOngoing: false })).toBe('2020-05');
    expect(formatRange({ start: null, end: null, isOngoing: false })).toBe('Undated');
  });
});

describe('groupByYear', () => {
  it('groups newest-first entries and puts ongoing in the current year', () => {
    const groups = groupByYear(
      [
        entry({ id: 'a', start: '2024-01-01', isOngoing: true }),
        entry({ id: 'b', start: '2025-02-01', end: '2026-01-01' }),
        entry({ id: 'c', start: '2022-02-01', end: '2022-09-01' }),
        entry({ id: 'd' }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.year, g.entries.map((e) => e.id)])).toEqual([
      [2026, ['a', 'b']],
      [2022, ['c']],
    ]);
  });
});

describe('availableYears', () => {
  it('covers every year in each range, newest first', () => {
    const years = availableYears(
      [
        entry({ start: '2023-01-01', end: '2024-06-01' }),
        entry({ start: '2025-01-01', isOngoing: true }),
      ],
      NOW,
    );
    expect(years).toEqual([2026, 2025, 2024, 2023]);
  });
});
