import { describe, expect, it } from 'vitest';
import {
  achievement,
  edge,
  evidence,
  graphOf,
  project,
  skill,
  story,
} from './graph-fixtures';
import {
  buildEvidenceGraph,
  buildGraphIndex,
  explainRelation,
  neighborsOf,
  nodeKey,
  parseLooseDate,
  monthsBetween,
  shortestPath,
} from './graph';

function sample() {
  const p1 = project({ name: 'Alpha', role: 'Lead' });
  const p2 = project({ name: 'Beta' });
  const sk = skill({ name: 'Python', category: 'Language' });
  const sk2 = skill({ name: 'Isolated' });
  const ev = evidence({ title: 'Repo README', verificationState: 'VERIFIED' });
  const a = achievement({ title: 'Won hackathon' });
  const st = story({ title: 'Outage story' });
  const e1 = edge(['PROJECT', p1.id], ['SKILL', sk.id], 'DEMONSTRATES', 'USER_PROVIDED');
  const e2 = edge(['PROJECT', p2.id], ['SKILL', sk.id], 'USES', 'INFERRED');
  const e3 = edge(['EVIDENCE', ev.id], ['PROJECT', p1.id], 'SUPPORTS', 'VERIFIED');
  const e4 = edge(
    ['ACHIEVEMENT', a.id],
    ['PROJECT', p2.id],
    'BELONGS_TO',
    'USER_PROVIDED',
  );
  const dangling = edge(
    ['STORY', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
    ['SKILL', sk.id],
    'DEMONSTRATES',
  );
  const g = graphOf({
    projects: [p1, p2],
    skills: [sk, sk2],
    evidence: [ev],
    achievements: [a],
    stories: [st],
    edges: [e1, e2, e3, e4, dangling],
  });
  return { g, p1, p2, sk, sk2, ev, a, st, e1, e2, e3, e4 };
}

describe('buildGraphIndex', () => {
  it('keys nodes as TYPE:uuid and drops dangling edges', () => {
    const { g, p1, sk } = sample();
    const idx = buildGraphIndex(g);
    expect(idx.nodes.has(`PROJECT:${p1.id}`)).toBe(true);
    expect(idx.edges).toHaveLength(4);
    expect(idx.adjacency.get(nodeKey('SKILL', sk.id))).toHaveLength(2);
  });

  it('upgrades an entity hint to VERIFIED via a confirmed link to verified evidence', () => {
    const { g, p1, p2 } = sample();
    const idx = buildGraphIndex(g);
    expect(idx.nodes.get(nodeKey('PROJECT', p1.id))!.verificationHint).toBe('VERIFIED');
    expect(idx.nodes.get(nodeKey('PROJECT', p2.id))!.verificationHint).toBe(
      'USER_PROVIDED',
    );
  });
});

describe('buildEvidenceGraph', () => {
  it('returns all nodes and valid links by default', () => {
    const { g } = sample();
    const v = buildEvidenceGraph(g);
    expect(v.nodes).toHaveLength(7);
    expect(v.links).toHaveLength(4);
    expect(v.truncated).toBe(false);
    for (const l of v.links) {
      expect(v.nodes.some((n) => n.id === l.source)).toBe(true);
      expect(v.nodes.some((n) => n.id === l.target)).toBe(true);
    }
  });

  it('filters by node type and relation', () => {
    const { g } = sample();
    const v = buildEvidenceGraph(g, {
      nodeTypes: ['PROJECT', 'SKILL'],
      relations: ['DEMONSTRATES', 'USES'],
    });
    expect(new Set(v.nodes.map((n) => n.type))).toEqual(new Set(['PROJECT', 'SKILL']));
    expect(v.links.map((l) => l.relation).sort()).toEqual(['DEMONSTRATES', 'USES']);
  });

  it('hides links below the minimum verification', () => {
    const { g } = sample();
    const v = buildEvidenceGraph(g, { minVerification: 'USER_PROVIDED' });
    expect(v.links.map((l) => l.verificationState)).not.toContain('INFERRED');
    expect(v.links).toHaveLength(3);
  });

  it('searches label text and keeps direct neighbors for context', () => {
    const { g } = sample();
    const v = buildEvidenceGraph(g, { search: 'hackathon' });
    expect(v.nodes.map((n) => n.label).sort()).toEqual(['Beta', 'Won hackathon']);
    expect(v.links).toHaveLength(1);
  });

  it('limits to a BFS neighborhood of the focus node', () => {
    const { g, ev, p1 } = sample();
    const d0 = buildEvidenceGraph(g, {
      focus: { nodeKey: nodeKey('EVIDENCE', ev.id), depth: 0 },
    });
    expect(d0.nodes).toHaveLength(1);
    const d1 = buildEvidenceGraph(g, {
      focus: { nodeKey: nodeKey('EVIDENCE', ev.id), depth: 1 },
    });
    expect(d1.nodes.map((n) => n.id).sort()).toEqual(
      [nodeKey('EVIDENCE', ev.id), nodeKey('PROJECT', p1.id)].sort(),
    );
    const d3 = buildEvidenceGraph(g, {
      focus: { nodeKey: nodeKey('EVIDENCE', ev.id), depth: 4 },
    });
    expect(d3.nodes.map((n) => n.label)).toContain('Won hackathon');
    expect(d3.nodes.map((n) => n.label)).not.toContain('Isolated');
  });

  it('returns an empty graph for an unknown focus node', () => {
    const { g } = sample();
    expect(
      buildEvidenceGraph(g, { focus: { nodeKey: 'PROJECT:nope', depth: 2 } }).nodes,
    ).toEqual([]);
  });

  it('caps nodes deterministically by degree and flags truncation', () => {
    const { g, sk } = sample();
    const v = buildEvidenceGraph(g, { maxNodes: 3 });
    expect(v.truncated).toBe(true);
    expect(v.totalNodes).toBe(7);
    expect(v.nodes).toHaveLength(3);
    expect(v.nodes.map((n) => n.id)).toContain(nodeKey('SKILL', sk.id));
    expect(buildEvidenceGraph(g, { maxNodes: 3 })).toEqual(v);
    for (const l of v.links) {
      expect(
        v.nodes.some((n) => n.id === l.source) && v.nodes.some((n) => n.id === l.target),
      ).toBe(true);
    }
  });

  it('always keeps the focus node when truncating', () => {
    const { g, sk2 } = sample();
    const v = buildEvidenceGraph(g, {
      maxNodes: 1,
      focus: { nodeKey: nodeKey('SKILL', sk2.id), depth: 0 },
    });
    expect(v.nodes.map((n) => n.id)).toEqual([nodeKey('SKILL', sk2.id)]);
  });
});

describe('neighborsOf / shortestPath / explainRelation', () => {
  it('lists neighbors with direction', () => {
    const { g, sk, p1 } = sample();
    const n = neighborsOf(g, nodeKey('SKILL', sk.id));
    expect(n.map((x) => x.node.label)).toEqual(['Alpha', 'Beta']);
    expect(n.every((x) => x.direction === 'IN')).toBe(true);
    expect(neighborsOf(g, nodeKey('PROJECT', p1.id)).map((x) => x.direction)).toContain(
      'OUT',
    );
  });

  it('finds the shortest path across edges, treating them as undirected', () => {
    const { g, ev, a } = sample();
    const p = shortestPath(g, nodeKey('EVIDENCE', ev.id), nodeKey('ACHIEVEMENT', a.id))!;
    expect(p.nodeKeys).toHaveLength(5); // evidence - alpha - python - beta - achievement
    expect(p.edgeIds).toHaveLength(4);
  });

  it('respects a verification filter when pathing', () => {
    const { g, ev, a } = sample();
    expect(
      shortestPath(g, nodeKey('EVIDENCE', ev.id), nodeKey('ACHIEVEMENT', a.id), {
        minVerification: 'USER_PROVIDED',
      }),
    ).toBeNull();
  });

  it('returns null for unreachable or unknown nodes and a trivial path for same node', () => {
    const { g, sk2, ev } = sample();
    expect(
      shortestPath(g, nodeKey('SKILL', sk2.id), nodeKey('EVIDENCE', ev.id)),
    ).toBeNull();
    expect(shortestPath(g, 'X:1', nodeKey('EVIDENCE', ev.id))).toBeNull();
    expect(shortestPath(g, nodeKey('SKILL', sk2.id), nodeKey('SKILL', sk2.id))).toEqual({
      nodeKeys: [nodeKey('SKILL', sk2.id)],
      edgeIds: [],
    });
  });

  it('explains links in a human sentence including trust level', () => {
    const { g } = sample();
    const v = buildEvidenceGraph(g);
    const l = v.links.find((x) => x.relation === 'USES')!;
    expect(explainRelation(l)).toBe(
      '"Beta" uses "Python" (inferred, not yet confirmed).',
    );
  });
});

describe('date helpers', () => {
  it('parses partial dates and rejects garbage', () => {
    expect(parseLooseDate('2024')!.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(parseLooseDate('2024-05')!.toISOString()).toBe('2024-05-01T00:00:00.000Z');
    expect(parseLooseDate('2024-05-17T10:00:00Z')!.toISOString()).toBe(
      '2024-05-17T00:00:00.000Z',
    );
    expect(parseLooseDate('present')).toBeNull();
    expect(parseLooseDate(null)).toBeNull();
  });
  it('counts whole months and never goes negative', () => {
    expect(monthsBetween(new Date('2026-01-31'), new Date('2026-03-30'))).toBe(1);
    expect(monthsBetween(new Date('2026-05-01'), new Date('2026-01-01'))).toBe(0);
  });
});
