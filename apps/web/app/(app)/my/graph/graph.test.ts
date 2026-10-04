import type { NodeType, VizGraph, VizLink, VizNode } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  filterGraph,
  groupNodes,
  neighborhood,
  relationPhrase,
  relationsOf,
} from './graph-filters';
import { layoutGraph } from './graph-layout';
import { nodeHref, safeExternalUrl } from './node-links';

const node = (
  id: string,
  type: NodeType,
  label = id,
  hint: VizNode['verificationHint'] = 'USER_PROVIDED',
): VizNode => ({
  id,
  type,
  label,
  verificationHint: hint,
  meta: {},
});
const link = (
  id: string,
  source: string,
  target: string,
  relation: VizLink['relation'] = 'USES',
  verificationState: VizLink['verificationState'] = 'USER_PROVIDED',
): VizLink => ({
  id,
  source,
  target,
  relation,
  verificationState,
  label: relation.toLowerCase(),
  sourceLabel: source,
  targetLabel: target,
});

const viz: VizGraph = {
  nodes: [
    node('PROJECT:p1', 'PROJECT', 'Career OS'),
    node('PROJECT:p2', 'PROJECT', 'Other'),
    node('SKILL:s1', 'SKILL', 'Python'),
    node('SKILL:s2', 'SKILL', 'React', 'INFERRED'),
    node('EVIDENCE:e1', 'EVIDENCE', 'Repo', 'VERIFIED'),
    node('ACHIEVEMENT:a1', 'ACHIEVEMENT', 'Award'),
  ],
  links: [
    link('l1', 'PROJECT:p1', 'SKILL:s1'),
    link('l2', 'PROJECT:p1', 'SKILL:s2', 'USES', 'INFERRED'),
    link('l3', 'EVIDENCE:e1', 'PROJECT:p1', 'SUPPORTS', 'VERIFIED'),
    link('l4', 'ACHIEVEMENT:a1', 'PROJECT:p2', 'BELONGS_TO'),
  ],
  truncated: false,
  totalNodes: 6,
  totalLinks: 4,
};

const ALL_TYPES = new Set<NodeType>([
  'PROJECT',
  'SKILL',
  'EXPERIENCE',
  'EDUCATION',
  'ACHIEVEMENT',
  'STORY',
  'EVIDENCE',
]);
const ALL_RELS = new Set([
  'DEMONSTRATES',
  'USES',
  'BELONGS_TO',
  'SUPPORTS',
  'REPRESENTS',
  'REFERENCES',
] as const);
const base = {
  types: ALL_TYPES,
  relations: ALL_RELS,
  minVerification: null,
  focus: null,
  search: '',
};

describe('layoutGraph', () => {
  it('is deterministic and independent of input order', () => {
    const a = layoutGraph(viz.nodes, viz.links);
    const b = layoutGraph([...viz.nodes].reverse(), [...viz.links].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(layoutGraph(viz.nodes, viz.links))).toBe(JSON.stringify(a));
  });

  it('places every node at finite coordinates, projects inside skills', () => {
    const { positions, maxRadius } = layoutGraph(viz.nodes, viz.links);
    expect(Object.keys(positions)).toHaveLength(viz.nodes.length);
    for (const p of Object.values(positions)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    const r = (id: string) => Math.hypot(positions[id]!.x, positions[id]!.y);
    expect(r('PROJECT:p1')).toBeLessThan(r('SKILL:s1'));
    expect(maxRadius).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    expect(layoutGraph([], [])).toEqual({ positions: {}, maxRadius: 0 });
  });

  it('keeps ring spacing for large rings', () => {
    const nodes = Array.from({ length: 120 }, (_, i) => node(`SKILL:${i}`, 'SKILL'));
    const { positions } = layoutGraph(nodes, []);
    const pts = Object.values(positions);
    let min = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    expect(min).toBeGreaterThan(40);
  });
});

describe('filterGraph', () => {
  it('returns everything with no filters', () => {
    const r = filterGraph(viz, base);
    expect(r.nodeIds.size).toBe(6);
    expect(r.linkIds.size).toBe(4);
  });

  it('filters by node type and drops links to hidden nodes', () => {
    const r = filterGraph(viz, {
      ...base,
      types: new Set<NodeType>(['PROJECT', 'SKILL']),
    });
    expect(r.nodeIds.has('EVIDENCE:e1')).toBe(false);
    expect([...r.linkIds].sort()).toEqual(['l1', 'l2']);
  });

  it('filters by relation', () => {
    const r = filterGraph(viz, { ...base, relations: new Set(['SUPPORTS'] as const) });
    expect([...r.linkIds]).toEqual(['l3']);
  });

  it('applies minimum verification to nodes and links', () => {
    const r = filterGraph(viz, { ...base, minVerification: 'USER_PROVIDED' });
    expect(r.nodeIds.has('SKILL:s2')).toBe(false);
    expect(r.linkIds.has('l2')).toBe(false);
    expect(r.nodeIds.has('EVIDENCE:e1')).toBe(true);
  });

  it('focus restricts to the BFS neighbourhood', () => {
    const d1 = filterGraph(viz, { ...base, focus: { id: 'SKILL:s1', depth: 1 } });
    expect([...d1.nodeIds].sort()).toEqual(['PROJECT:p1', 'SKILL:s1']);
    const d2 = filterGraph(viz, { ...base, focus: { id: 'SKILL:s1', depth: 2 } });
    expect(d2.nodeIds.has('EVIDENCE:e1')).toBe(true);
    expect(d2.nodeIds.has('PROJECT:p2')).toBe(false);
  });

  it('focus on a filtered-out node yields nothing', () => {
    const r = filterGraph(viz, {
      ...base,
      types: new Set<NodeType>(['SKILL']),
      focus: { id: 'PROJECT:p1', depth: 1 },
    });
    expect(r.nodeIds.size).toBe(0);
  });

  it('search matches label case-insensitively among visible nodes', () => {
    expect(filterGraph(viz, { ...base, search: 'pyTHON' }).matches).toEqual(['SKILL:s1']);
    expect(filterGraph(viz, { ...base, search: '   ' }).matches).toEqual([]);
  });
});

describe('helpers', () => {
  it('neighborhood depth 0 is the node alone', () => {
    expect([...neighborhood(viz.links, 'PROJECT:p1', 0)]).toEqual(['PROJECT:p1']);
  });

  it('relationsOf lists both directions with phrases', () => {
    const rels = relationsOf(viz, 'PROJECT:p1');
    expect(rels).toHaveLength(3);
    const phrases = rels.map(relationPhrase);
    expect(phrases).toContain('uses Python');
    expect(phrases).toContain('Repo supports this');
  });

  it('groupNodes groups, sorts and filters', () => {
    const g = groupNodes(viz.nodes, ['PROJECT', 'SKILL'], 'o');
    expect(g.map((x) => x.type)).toEqual(['PROJECT', 'SKILL']);
    expect(g[1]!.nodes.map((n) => n.label)).toEqual(['Python']);
  });

  it('nodeHref and safeExternalUrl', () => {
    expect(nodeHref('PROJECT', 'abc')).toBe('/my/projects/abc');
    expect(nodeHref('SKILL', 'x')).toBe('/my/skills');
    expect(nodeHref('STORY', 'x')).toBe('/my/stories/x');
    expect(nodeHref('EVIDENCE', 'x')).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl(null)).toBeNull();
  });
});
