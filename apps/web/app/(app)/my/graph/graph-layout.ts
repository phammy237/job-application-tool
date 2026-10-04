import type { NodeType } from '@career-os/shared';

/**
 * Deterministic radial layout for the evidence graph. Pure: no randomness, no clock — the same
 * input always yields identical coordinates (rounded to 0.1).
 *
 * Rings, inner to outer: projects, achievements, experience, education, stories, evidence, skills.
 * Within a ring nodes are ordered by the circular-mean angle of their already-placed neighbours
 * (barycentre heuristic) to keep connected nodes angularly close and reduce edge crossings.
 */

export interface LayoutNode {
  id: string;
  type: NodeType;
}
export interface LayoutLink {
  source: string;
  target: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface GraphLayout {
  positions: Record<string, Point>;
  /** Radius of the outermost ring (for fit-to-view). */
  maxRadius: number;
}

const RING_ORDER: readonly NodeType[] = [
  'PROJECT',
  'ACHIEVEMENT',
  'EXPERIENCE',
  'EDUCATION',
  'STORY',
  'EVIDENCE',
  'SKILL',
];
const MIN_SPACING = 46; // px between neighbours on a ring
const RING_GAP = 110;
const FIRST_RADIUS = 90;
const TAU = 2 * Math.PI;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function circularMean(angles: number[]): number | null {
  if (!angles.length) return null;
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null;
  return Math.atan2(sy, sx);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function layoutGraph(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
): GraphLayout {
  const neighbors = new Map<string, string[]>();
  for (const l of links) {
    push(neighbors, l.source, l.target);
    push(neighbors, l.target, l.source);
  }
  const byType = new Map<NodeType, LayoutNode[]>();
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id)))
    push(byType, n.type, n);

  const angleOf = new Map<string, number>();
  const positions: Record<string, Point> = {};
  let prevRadius = 0;
  let maxRadius = 0;

  for (const type of RING_ORDER) {
    const group = byType.get(type);
    if (!group?.length) continue;
    const needed = (group.length * MIN_SPACING) / TAU;
    const radius = Math.max(
      prevRadius === 0 ? FIRST_RADIUS : prevRadius + RING_GAP,
      needed,
    );

    const unplacedTotal = group.filter(
      (n) => !(neighbors.get(n.id) ?? []).some((o) => angleOf.has(o)),
    ).length;
    let seq = 0;
    const withAngle = group.map((n) => {
      const placed = (neighbors.get(n.id) ?? [])
        .map((o) => angleOf.get(o))
        .filter((a): a is number => a !== undefined);
      const mean = circularMean(placed);
      const sortAngle =
        mean !== null
          ? (mean + TAU) % TAU
          : ((seq++ + 0.5) / Math.max(1, unplacedTotal)) * TAU;
      return { n, sortAngle };
    });
    withAngle.sort((a, b) => a.sortAngle - b.sortAngle || a.n.id.localeCompare(b.n.id));
    const offset = withAngle[0]?.sortAngle ?? 0;
    withAngle.forEach((k, idx) => {
      const angle = offset + (idx / withAngle.length) * TAU;
      angleOf.set(k.n.id, angle);
      positions[k.n.id] = {
        x: round1(Math.cos(angle) * radius),
        y: round1(Math.sin(angle) * radius),
      };
    });
    prevRadius = radius;
    maxRadius = radius;
  }
  return { positions, maxRadius };
}
