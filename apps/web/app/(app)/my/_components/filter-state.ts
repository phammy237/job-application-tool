/**
 * Pure filter / sort / URL helpers behind <FilterableList>. No React, no I/O: unit-testable.
 */

/** Current filter values by URL param name ('' or missing = not filtered). */
export type FilterState = Record<string, string>;

export interface FilterItemData {
  id: string;
  /** Lower-cased text matched by the free-text search. */
  text?: string;
  /** Facet values by param. An array matches if it contains the value; '*' matches anything. */
  facets?: Record<string, string | string[]>;
  /** Sort values by sort option value. Strings sort A→Z, numbers by the option's direction. */
  sortValues?: Record<string, string | number>;
  /** Group key (e.g. timeline year). */
  group?: string;
}

export interface SortOption {
  value: string;
  label: string;
  /** Direction for numeric values; strings always sort ascending. Default 'desc'. */
  dir?: 'asc' | 'desc';
}

function facetMatches(v: string | string[] | undefined, wanted: string): boolean {
  if (v === undefined) return false;
  const list = Array.isArray(v) ? v : [v];
  return list.includes('*') || list.includes(wanted);
}

export function applyListFilters<T extends FilterItemData>(
  items: readonly T[],
  state: FilterState,
  sorts?: readonly SortOption[],
): T[] {
  const q = (state.q ?? '').trim().toLowerCase();
  const out = items.filter((it) => {
    if (q && !(it.text ?? '').toLowerCase().includes(q)) return false;
    for (const [param, wanted] of Object.entries(state)) {
      if (param === 'q' || param === 'sort' || !wanted) continue;
      if (!facetMatches(it.facets?.[param], wanted)) return false;
    }
    return true;
  });
  const sortValue = state.sort || sorts?.[0]?.value;
  const opt = sorts?.find((s) => s.value === sortValue);
  if (!opt) return out;
  const dir = opt.dir === 'asc' ? 1 : -1;
  // Stable: ties keep the server's order.
  return out
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const av = a.it.sortValues?.[opt.value];
      const bv = b.it.sortValues?.[opt.value];
      if (av === bv || av === undefined || bv === undefined) {
        if (av === undefined && bv !== undefined) return 1;
        if (bv === undefined && av !== undefined) return -1;
        return a.i - b.i;
      }
      if (typeof av === 'string' || typeof bv === 'string')
        return String(av).localeCompare(String(bv)) || a.i - b.i;
      return (av - bv) * dir || a.i - b.i;
    })
    .map((x) => x.it);
}

/** Number of active filters (a non-default sort does not count as a filter). */
export function activeFilterCount(state: FilterState): number {
  return Object.entries(state).filter(([k, v]) => k !== 'sort' && !!v).length;
}

/**
 * Rewrites only the `managed` params of an existing query string, leaving others (e.g. the dev
 * preview's `tab`) untouched. Empty values and the default sort are omitted.
 */
export function buildListQuery(
  currentSearch: string,
  managed: readonly string[],
  state: FilterState,
  defaultSort?: string,
): string {
  const qs = new URLSearchParams(currentSearch);
  for (const p of managed) {
    const v = (state[p] ?? '').trim();
    if (!v || (p === 'sort' && v === defaultSort)) qs.delete(p);
    else qs.set(p, v);
  }
  // Outcome codes are one-shot; do not keep re-showing them once the user interacts.
  qs.delete('notice');
  qs.delete('error');
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** First string value of a Next searchParams entry, bounded. */
export function paramValue(v: string | string[] | undefined, max = 100): string {
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? '').slice(0, max);
}
