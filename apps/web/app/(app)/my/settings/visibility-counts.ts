import type { EvidenceGraphData, Visibility } from '@career-os/shared';

export interface VisibilityCountRow {
  label: string;
  PUBLIC: number;
  CAREER_OS_ONLY: number;
  PRIVATE: number;
  /** How many of these items the v1 export can include (PUBLIC and, where required, approved). */
  exported: number;
  /** Plain-language note when the type never leaves Career OS. */
  note?: string;
}

function tally<T extends { visibility: Visibility }>(
  label: string,
  items: readonly T[],
  isExported: (item: T) => boolean,
  note?: string,
): VisibilityCountRow {
  const row: VisibilityCountRow = { label, PUBLIC: 0, CAREER_OS_ONLY: 0, PRIVATE: 0, exported: 0 };
  for (const item of items) {
    row[item.visibility] += 1;
    if (isExported(item)) row.exported += 1;
  }
  if (note) row.note = note;
  return row;
}

/** Counts per visibility level for every exportable-or-not item type. Pure. */
export function countByVisibility(graph: EvidenceGraphData): VisibilityCountRow[] {
  const publicApproved = (x: { visibility: Visibility; userApproved: boolean }): boolean =>
    x.visibility === 'PUBLIC' && x.userApproved;
  return [
    tally('Projects', graph.projects, publicApproved),
    tally('Skills', graph.skills, publicApproved),
    tally('Achievements', graph.achievements, publicApproved),
    tally('Evidence', graph.evidence, (e) => e.visibility === 'PUBLIC'),
    tally('Experiences', graph.experiences, () => false, 'Never exported in v1'),
    tally('Stories', graph.stories, () => false, 'Never exported in v1'),
  ];
}
