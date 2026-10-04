import type { AchievementKind, VerificationState } from '../../schemas/myos';
import type { EvidenceGraphData } from './graph-types';
import { asIndex, nodeKey, otherEnd, parseLooseDate, type GraphIndex } from './graph';

/**
 * Chronological career timeline merged from projects, experiences, education, and achievements.
 *
 * Entry id: `${SOURCE}:${uuid}` where SOURCE is PROJECT | EXPERIENCE | EDUCATION | ACHIEVEMENT.
 * Type mapping: project -> PROJECT, experience -> WORK, education -> EDUCATION,
 * achievement kind ACHIEVEMENT/METRIC -> ACHIEVEMENT, AWARD -> AWARD, LAUNCH -> LAUNCH,
 * LEADERSHIP -> LEADERSHIP, MILESTONE -> MILESTONE.
 *
 * href (in-app routes): PROJECT -> `/my/projects/{id}`; WORK and EDUCATION -> `/profile`;
 * achievement types -> `/my/achievements`.
 *
 * Ordering: newest first by (end ?? start); ongoing entries sort as "now". Entries with no date at
 * all go to `undated` (sorted by title) and are never dropped. The `year` filter does not apply
 * to undated entries (they stay visible in their own list); `types` and `skillId` apply to all.
 * isOngoing: projects with a start and no end that are not COMPLETED/ARCHIVED; experiences with a
 * start and no end; education whose graduation date is after `now`.
 */

export type TimelineEntryType =
  | 'PROJECT'
  | 'WORK'
  | 'EDUCATION'
  | 'ACHIEVEMENT'
  | 'AWARD'
  | 'LAUNCH'
  | 'LEADERSHIP'
  | 'MILESTONE';

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  title: string;
  subtitle: string | null;
  start: string | null;
  end: string | null;
  isOngoing: boolean;
  relatedSkillNames: string[];
  evidenceCount: number;
  verificationState: VerificationState;
  href: string;
}

export interface BuildTimelineOptions {
  now: Date;
  types?: readonly TimelineEntryType[];
  /** Calendar year the entry's date range overlaps. */
  year?: number;
  /** Only entries linked (DEMONSTRATES/USES) to this skill id. */
  skillId?: string;
}

export interface Timeline {
  entries: TimelineEntry[];
  undated: TimelineEntry[];
}

const KIND_TO_TYPE: Record<AchievementKind, TimelineEntryType> = {
  ACHIEVEMENT: 'ACHIEVEMENT',
  METRIC: 'ACHIEVEMENT',
  AWARD: 'AWARD',
  LAUNCH: 'LAUNCH',
  LEADERSHIP: 'LEADERSHIP',
  MILESTONE: 'MILESTONE',
};

interface Raw {
  entry: TimelineEntry;
  sourceKey: string;
  sortTime: number | null;
  startYear: number | null;
  endYear: number | null;
}

function yearOf(s: string | null, fallback?: Date): number | null {
  const d = parseLooseDate(s);
  return d ? d.getUTCFullYear() : fallback ? fallback.getUTCFullYear() : null;
}

export function buildTimeline(
  graph: EvidenceGraphData | GraphIndex,
  opts: BuildTimelineOptions,
): Timeline {
  const index = asIndex(graph);
  const { now } = opts;
  const nowTime = now.getTime();

  const skillsOf = (key: string): { names: string[]; ids: Set<string> } => {
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const ie of index.adjacency.get(key) ?? []) {
      if (ie.edge.relation !== 'DEMONSTRATES' && ie.edge.relation !== 'USES') continue;
      const other = index.nodes.get(otherEnd(ie, key));
      if (other?.type !== 'SKILL') continue;
      names.add(other.label);
      ids.add(other.id);
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), ids };
  };
  const evidenceOf = (key: string): number => {
    const ids = new Set<string>();
    for (const ie of index.adjacency.get(key) ?? []) {
      if (ie.edge.relation !== 'SUPPORTS') continue;
      const other = index.nodes.get(otherEnd(ie, key));
      if (other?.type === 'EVIDENCE') ids.add(other.id);
    }
    return ids.size;
  };

  const raws: Array<Raw & { skillIds: Set<string> }> = [];
  const push = (
    sourceType: 'PROJECT' | 'EXPERIENCE' | 'EDUCATION' | 'ACHIEVEMENT',
    id: string,
    type: TimelineEntryType,
    title: string,
    subtitle: string | null,
    start: string | null,
    end: string | null,
    isOngoing: boolean,
    href: string,
  ): void => {
    const key = nodeKey(sourceType, id);
    const node = index.nodes.get(key);
    if (!node) return;
    const startD = parseLooseDate(start);
    const endD = parseLooseDate(end);
    const skills = skillsOf(key);
    const sortTime = isOngoing ? nowTime : ((endD ?? startD)?.getTime() ?? null);
    raws.push({
      sourceKey: key,
      sortTime,
      startYear: startD ? startD.getUTCFullYear() : endD ? endD.getUTCFullYear() : null,
      endYear: isOngoing ? now.getUTCFullYear() : (yearOf(end) ?? yearOf(start)),
      skillIds: skills.ids,
      entry: {
        id: key,
        type,
        title,
        subtitle,
        start,
        end,
        isOngoing,
        relatedSkillNames: skills.names,
        evidenceCount: evidenceOf(key),
        verificationState: node.verificationHint,
        href,
      },
    });
  };

  // Rebuild source rows from the index so a GraphIndex input works too.
  for (const node of index.nodes.values()) {
    const m = node.meta;
    const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    if (node.type === 'PROJECT') {
      const start = s(m.startDate);
      const end = s(m.endDate);
      const status = s(m.status);
      const ongoing = !!start && !end && status !== 'COMPLETED' && status !== 'ARCHIVED';
      push(
        'PROJECT',
        node.id,
        'PROJECT',
        node.label,
        node.sublabel,
        start,
        end,
        ongoing,
        `/my/projects/${node.id}`,
      );
    } else if (node.type === 'EXPERIENCE') {
      const start = s(m.startDate);
      const end = s(m.endDate);
      push(
        'EXPERIENCE',
        node.id,
        'WORK',
        node.label,
        node.sublabel,
        start,
        end,
        !!start && !end,
        '/profile',
      );
    } else if (node.type === 'EDUCATION') {
      const start = s(m.startDate);
      const end = s(m.graduationDate);
      const grad = parseLooseDate(end);
      push(
        'EDUCATION',
        node.id,
        'EDUCATION',
        node.label,
        node.sublabel,
        start,
        end,
        !!grad && grad.getTime() > nowTime,
        '/profile',
      );
    } else if (node.type === 'ACHIEVEMENT') {
      const kind = (s(m.kind) ?? 'ACHIEVEMENT') as AchievementKind;
      const related = (index.adjacency.get(node.key) ?? [])
        .map((ie) => index.nodes.get(otherEnd(ie, node.key)))
        .filter((n) => n?.type === 'PROJECT')
        .map((n) => n!.label)
        .sort((a, b) => a.localeCompare(b))[0];
      push(
        'ACHIEVEMENT',
        node.id,
        KIND_TO_TYPE[kind],
        node.label,
        related ?? null,
        s(m.occurredOn),
        null,
        false,
        '/my/achievements',
      );
    }
  }

  const typeSet = opts.types ? new Set<TimelineEntryType>(opts.types) : null;
  const passes = (r: Raw & { skillIds: Set<string> }): boolean => {
    if (typeSet && !typeSet.has(r.entry.type)) return false;
    if (opts.skillId && !r.skillIds.has(opts.skillId)) return false;
    return true;
  };
  const kept = raws.filter(passes);

  const dated = kept.filter((r) => r.sortTime !== null);
  const undated = kept.filter((r) => r.sortTime === null);
  const yearOk = (r: Raw): boolean => {
    if (opts.year === undefined) return true;
    const lo = r.startYear ?? r.endYear;
    const hi = r.endYear ?? r.startYear;
    return lo !== null && hi !== null && lo <= opts.year && opts.year <= hi;
  };

  const startTime = (r: Raw): number =>
    parseLooseDate(r.entry.start)?.getTime() ?? -Infinity;
  dated.sort(
    (a, b) =>
      (b.sortTime ?? 0) - (a.sortTime ?? 0) ||
      startTime(b) - startTime(a) ||
      a.entry.id.localeCompare(b.entry.id),
  );
  undated.sort(
    (a, b) =>
      a.entry.title.localeCompare(b.entry.title) || a.entry.id.localeCompare(b.entry.id),
  );

  return {
    entries: dated.filter(yearOk).map((r) => r.entry),
    undated: undated.map((r) => r.entry),
  };
}
