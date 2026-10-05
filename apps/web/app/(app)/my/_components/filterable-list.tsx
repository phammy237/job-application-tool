'use client';

import { Input, Label, Select } from '@career-os/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleGroup, CollapsibleGroupControls } from './collapsible';
import {
  applyListFilters,
  activeFilterCount,
  buildListQuery,
  type FilterItemData,
  type FilterState,
  type SortOption,
} from './filter-state';

/**
 * Instant client-side filter / search / sort over a server-rendered list. Each item carries its
 * pre-rendered node (forms and server actions keep working) plus plain filter data. The URL query
 * is kept in sync with history.replaceState so links stay shareable without a server round trip
 * on every keystroke (Next.js integrates native history updates with useSearchParams).
 */

export interface FilterItem extends FilterItemData {
  node: ReactNode;
}

export interface FacetConfig {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  /** 'chips' renders toggle chips; 'select' a dropdown. */
  kind?: 'chips' | 'select';
  allLabel?: string;
}

export interface ToggleConfig {
  param: string;
  label: string;
}

export interface GroupConfig {
  key: string;
  label: string;
  description?: ReactNode;
  defaultOpen?: boolean;
}

export interface FilterableListProps {
  items: FilterItem[];
  /** Initial values from the server's searchParams (shareable links). */
  initial: FilterState;
  search?: { label: string; placeholder?: string };
  facets?: FacetConfig[];
  toggles?: ToggleConfig[];
  sorts?: SortOption[];
  noun: { singular: string; plural: string };
  /** Render "Expand all / Collapse all" (items should contain Collapsibles). */
  expandControls?: boolean;
  groups?: GroupConfig[];
  /** Persist group open state under this prefix. */
  groupStorageKey?: string;
  as?: 'ul' | 'ol';
  listClassName?: string;
  /** Accessible label for the filter toolbar. */
  label: string;
  /** Extra toolbar content (rendered at the end of the toolbar row). */
  toolbarExtra?: ReactNode;
}

const chipBase =
  'focus-visible:ring-ring inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2';

function stateKey(s: FilterState): string {
  return JSON.stringify(s);
}

export function FilterableList({
  items,
  initial,
  search,
  facets = [],
  toggles = [],
  sorts,
  noun,
  expandControls = false,
  groups,
  groupStorageKey,
  as = 'ul',
  listClassName = 'space-y-2',
  label,
  toolbarExtra,
}: FilterableListProps) {
  const [state, setState] = useState<FilterState>(initial);
  const initialKey = stateKey(initial);
  const prevInitial = useRef(initialKey);

  // A server navigation with different params (e.g. a Link to ?competency=X) resets the state.
  useEffect(() => {
    if (prevInitial.current !== initialKey) {
      prevInitial.current = initialKey;
      setState(JSON.parse(initialKey) as FilterState);
    }
  }, [initialKey]);

  // Keep the URL in sync (debounced so typing does not spam history).
  const managed = useMemo(
    () => [
      ...(search ? ['q'] : []),
      ...facets.map((f) => f.param),
      ...toggles.map((t) => t.param),
      ...(sorts ? ['sort'] : []),
    ],
    [search, facets, toggles, sorts],
  );
  const defaultSort = sorts?.[0]?.value;
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const next = buildListQuery(window.location.search, managed, state, defaultSort);
        const url = `${window.location.pathname}${next}${window.location.hash}`;
        if (
          url !==
          `${window.location.pathname}${window.location.search}${window.location.hash}`
        )
          window.history.replaceState(window.history.state, '', url);
      } catch {
        // URL sync is a convenience only.
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [state, managed, defaultSort]);

  const visible = useMemo(
    () => applyListFilters(items, state, sorts),
    [items, state, sorts],
  );
  const filtered = activeFilterCount(state) > 0;

  const set = (param: string, value: string) =>
    setState((s) => ({ ...s, [param]: value }));
  const clearAll = () =>
    setState(() => (defaultSort ? { sort: defaultSort } : ({} as FilterState)));

  const chips: { param: string; label: string }[] = [];
  if (search && state.q) chips.push({ param: 'q', label: `“${state.q}”` });
  for (const f of facets) {
    const v = state[f.param];
    if (v) {
      const opt = f.options.find((o) => o.value === v);
      chips.push({ param: f.param, label: `${f.label}: ${opt?.label ?? v}` });
    }
  }
  for (const t of toggles)
    if (state[t.param]) chips.push({ param: t.param, label: t.label });

  const List = as;
  const renderItems = (list: FilterItem[]) => (
    <List className={listClassName}>
      {list.map((it) => (
        <li key={it.id}>{it.node}</li>
      ))}
    </List>
  );

  const content = groups ? (
    <div className="space-y-3">
      {groups.map((g) => {
        const inGroup = visible.filter((it) => it.group === g.key);
        if (inGroup.length === 0) return null;
        return (
          <Collapsible
            key={g.key}
            title={g.label}
            count={inGroup.length}
            headingLevel={2}
            variant="plain"
            defaultOpen={g.defaultOpen ?? true}
            storageKey={groupStorageKey ? `${groupStorageKey}:${g.key}` : undefined}
          >
            {g.description ? (
              <p className="text-muted-foreground mb-2 text-xs">{g.description}</p>
            ) : null}
            {renderItems(inGroup)}
          </Collapsible>
        );
      })}
    </div>
  ) : (
    renderItems(visible)
  );

  const body = (
    <div className="space-y-3">
      <div
        role="search"
        aria-label={label}
        className="border-border bg-card space-y-3 rounded-lg border p-3"
      >
        <div className="flex flex-wrap items-end gap-3">
          {search ? (
            <div className="min-w-0 flex-1 basis-48 space-y-1">
              <Label htmlFor={`${label}-q`}>{search.label}</Label>
              <Input
                id={`${label}-q`}
                type="search"
                value={state.q ?? ''}
                placeholder={search.placeholder}
                onChange={(e) => set('q', e.target.value.slice(0, 100))}
                autoComplete="off"
                className="h-10"
              />
            </div>
          ) : null}
          {facets
            .filter((f) => (f.kind ?? 'select') === 'select')
            .map((f) => (
              <div key={f.param} className="min-w-0 basis-40 space-y-1">
                <Label htmlFor={`${label}-${f.param}`}>{f.label}</Label>
                <Select
                  id={`${label}-${f.param}`}
                  value={state[f.param] ?? ''}
                  onChange={(e) => set(f.param, e.target.value)}
                  className="h-10"
                >
                  <option value="">{f.allLabel ?? 'All'}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          {sorts && sorts.length > 1 ? (
            <div className="min-w-0 basis-36 space-y-1">
              <Label htmlFor={`${label}-sort`}>Sort by</Label>
              <Select
                id={`${label}-sort`}
                value={state.sort || defaultSort}
                onChange={(e) => set('sort', e.target.value)}
                className="h-10"
              >
                {sorts.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {toggles.map((t) => (
            <label
              key={t.param}
              className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={state[t.param] === '1'}
                onChange={(e) => set(t.param, e.target.checked ? '1' : '')}
                className="accent-primary focus-visible:ring-ring h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2"
              />
              {t.label}
            </label>
          ))}
          {toolbarExtra}
        </div>

        {facets
          .filter((f) => f.kind === 'chips')
          .map((f) => (
            <fieldset key={f.param} className="flex flex-wrap items-center gap-1.5">
              <legend className="text-muted-foreground float-left mr-2 w-12 text-xs">
                {f.label}
              </legend>
              {[{ value: '', label: f.allLabel ?? 'All' }, ...f.options].map((o) => {
                const active = (state[f.param] ?? '') === o.value;
                return (
                  <button
                    key={o.value || '__all'}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set(f.param, o.value)}
                    className={`${chipBase} ${
                      active
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {active ? <span aria-hidden="true">✓</span> : null}
                    {o.label}
                  </button>
                );
              })}
            </fieldset>
          ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            Showing {visible.length} of {items.length}{' '}
            {items.length === 1 ? noun.singular : noun.plural}
          </p>
          {chips.map((c) => (
            <button
              key={c.param}
              type="button"
              onClick={() => set(c.param, '')}
              className="bg-accent text-accent-foreground focus-visible:ring-ring inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2"
            >
              {c.label}
              <span aria-hidden="true">×</span>
              <span className="sr-only">(remove filter)</span>
            </button>
          ))}
          {filtered ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-primary focus-visible:ring-ring min-h-10 rounded-md px-2 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        {expandControls && visible.length > 0 ? (
          <CollapsibleGroupControls label={noun.plural} />
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-6 text-center text-sm">
          <p className="font-medium">No {noun.plural} match these filters.</p>
          <button
            type="button"
            onClick={clearAll}
            className="text-primary mt-1 min-h-10 font-medium underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        content
      )}
    </div>
  );

  return expandControls ? <CollapsibleGroup>{body}</CollapsibleGroup> : body;
}
