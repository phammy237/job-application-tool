import { describe, expect, it } from 'vitest';
import { activeFilterCount, applyListFilters, buildListQuery } from './filter-state';

const items = [
  {
    id: 'a',
    text: 'python fastapi',
    facets: { category: 'LANGUAGE', year: ['2024', '2025'] },
    sortValues: { name: 'python', n: 1 },
  },
  {
    id: 'b',
    text: 'react',
    facets: { category: 'FRAMEWORK', year: ['2025'] },
    sortValues: { name: 'react', n: 3 },
  },
  {
    id: 'c',
    text: 'undated thing',
    facets: { category: 'FRAMEWORK', year: ['*'] },
    sortValues: { name: 'alpha', n: 2 },
  },
];

describe('applyListFilters', () => {
  it('filters by text search (case-insensitive) and facet values', () => {
    expect(applyListFilters(items, { q: 'PYTH' }).map((i) => i.id)).toEqual(['a']);
    expect(applyListFilters(items, { category: 'FRAMEWORK' }).map((i) => i.id)).toEqual([
      'b',
      'c',
    ]);
    expect(applyListFilters(items, { year: '2024' }).map((i) => i.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('sorts numbers by direction and strings A→Z, stable on ties', () => {
    const sorts = [
      { value: 'n', label: 'N' },
      { value: 'name', label: 'Name', dir: 'asc' as const },
    ];
    expect(applyListFilters(items, {}, sorts).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(applyListFilters(items, { sort: 'name' }, sorts).map((i) => i.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('buildListQuery', () => {
  it('rewrites only managed params, drops empties, default sort and outcome codes', () => {
    expect(
      buildListQuery(
        '?tab=skills&q=old&notice=saved',
        ['q', 'sort', 'category'],
        {
          q: 'py',
          sort: 'strength',
          category: '',
        },
        'strength',
      ),
    ).toBe('?tab=skills&q=py');
    expect(buildListQuery('', ['q'], { q: '' })).toBe('');
  });
});

describe('activeFilterCount', () => {
  it('ignores sort and empty values', () => {
    expect(activeFilterCount({ q: '', sort: 'name', category: 'X' })).toBe(1);
  });
});
