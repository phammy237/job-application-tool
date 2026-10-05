import type { TimelineEntry, TimelineEntryType } from '@career-os/shared';

export const TIMELINE_TYPES: readonly TimelineEntryType[] = [
  'WORK',
  'PROJECT',
  'EDUCATION',
  'ACHIEVEMENT',
  'AWARD',
  'LAUNCH',
  'LEADERSHIP',
  'MILESTONE',
];

export const TYPE_LABELS: Record<TimelineEntryType, string> = {
  WORK: 'Work',
  PROJECT: 'Project',
  EDUCATION: 'Education',
  ACHIEVEMENT: 'Achievement',
  AWARD: 'Award',
  LAUNCH: 'Launch',
  LEADERSHIP: 'Leadership',
  MILESTONE: 'Milestone',
};

export interface TimelineParams {
  type: TimelineEntryType | null;
  year: number | null;
  skillId: string | null;
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export function parseTimelineParams(
  sp: Record<string, string | string[] | undefined>,
): TimelineParams {
  const type = first(sp.type);
  const year = Number.parseInt(first(sp.year), 10);
  const skill = first(sp.skill);
  return {
    type: (TIMELINE_TYPES as readonly string[]).includes(type)
      ? (type as TimelineEntryType)
      : null,
    year: Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null,
    skillId: /^[0-9a-fA-F-]{36}$/.test(skill) ? skill : null,
  };
}

/** Builds a /my/timeline URL with the given filter overrides (null clears a filter). */
export function timelineHref(
  current: TimelineParams,
  override: Partial<{ [K in keyof TimelineParams]: TimelineParams[K] | null }>,
): string {
  const merged = { ...current, ...override };
  const qs = new URLSearchParams();
  if (merged.type) qs.set('type', merged.type);
  if (merged.year !== null && merged.year !== undefined)
    qs.set('year', String(merged.year));
  if (merged.skillId) qs.set('skill', merged.skillId);
  const s = qs.toString();
  return s ? `/my/timeline?${s}` : '/my/timeline';
}

/**
 * Every in-app destination for a timeline entry. Achievement-like entries link to their row on
 * /my/achievements (anchor `a-<id>`); the others keep the href buildTimeline produced
 * (/my/projects/<id>, /profile), which all resolve to existing routes.
 */
export function resolveEntryHref(entry: TimelineEntry): string {
  if (entry.id.startsWith('ACHIEVEMENT:')) {
    return `/my/achievements#a-${entry.id.slice('ACHIEVEMENT:'.length)}`;
  }
  return entry.href;
}

function monthPart(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(value);
  if (!m) return value;
  return m[2] ? `${m[1]}-${m[2]}` : m[1]!;
}

/** "2023-04 – Present", "2021-01 – 2022-06", "2020-05", or "Undated". */
export function formatRange(
  entry: Pick<TimelineEntry, 'start' | 'end' | 'isOngoing'>,
): string {
  const start = monthPart(entry.start);
  const end = entry.isOngoing ? 'Present' : monthPart(entry.end);
  if (start && end && start !== end) return `${start} – ${end}`;
  if (start && !end) return start;
  return end ?? start ?? 'Undated';
}

function groupYear(entry: TimelineEntry, now: Date): number | null {
  if (entry.isOngoing) return now.getUTCFullYear();
  const m = /^(\d{4})/.exec(entry.end ?? entry.start ?? '');
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export interface YearGroup {
  year: number;
  entries: TimelineEntry[];
}

/** Groups already-sorted (newest first) entries by the year they end (or "now" if ongoing). */
export function groupByYear(entries: readonly TimelineEntry[], now: Date): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const entry of entries) {
    const year = groupYear(entry, now);
    if (year === null) continue;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}

/** Calendar years (ascending) one entry's date range overlaps; [] when it has no dates. */
export function entryYears(
  e: Pick<TimelineEntry, 'start' | 'end' | 'isOngoing'>,
  now: Date,
): number[] {
  const startM = /^(\d{4})/.exec(e.start ?? '');
  const endM = /^(\d{4})/.exec(e.end ?? '');
  const lo = startM ? Number.parseInt(startM[1]!, 10) : null;
  const hi = e.isOngoing
    ? now.getUTCFullYear()
    : endM
      ? Number.parseInt(endM[1]!, 10)
      : lo;
  const from = lo ?? hi;
  if (from === null || hi === null) return [];
  const low = Math.min(from, hi);
  const high = Math.max(from, hi);
  const out: number[] = [];
  for (let y = low; y <= high && y - low < 60; y++) out.push(y);
  return out;
}

/** Years (newest first) any entry's range overlaps, for the year filter chips. */
export function availableYears(entries: readonly TimelineEntry[], now: Date): number[] {
  const years = new Set<number>();
  for (const e of entries) for (const y of entryYears(e, now)) years.add(y);
  return [...years].sort((a, b) => b - a);
}
