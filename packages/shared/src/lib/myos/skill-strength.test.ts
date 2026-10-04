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
  SKILL_STRENGTH_RULES,
  computeAllSkillStrengths,
  computeSkillStrength,
  evidenceCoverage,
} from './skill-strength';
import type { EvidenceGraphData } from './graph-types';

const NOW = new Date('2026-06-15T00:00:00.000Z');

function setup(
  n: number,
  opts: { state?: 'USER_PROVIDED' | 'INFERRED'; end?: string | null } = {},
) {
  const s = skill({ name: 'Python' });
  const projects = Array.from({ length: n }, (_, i) =>
    project({
      name: `P${i}`,
      startDate: '2024-01-01',
      endDate: opts.end === undefined ? '2026-03-01' : opts.end,
    }),
  );
  const edges = projects.map((p) =>
    edge(
      ['PROJECT', p.id],
      ['SKILL', s.id],
      'DEMONSTRATES',
      opts.state ?? 'USER_PROVIDED',
    ),
  );
  return { s, projects, edges };
}

describe('computeSkillStrength levels', () => {
  it('is NONE with no supporting entities, even if loose evidence points at the skill', () => {
    const s = skill();
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      evidence: [ev],
      edges: [edge(['EVIDENCE', ev.id], ['SKILL', s.id], 'SUPPORTS')],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('NONE');
    expect(r.supportingEntities).toEqual([]);
    expect(r.recency).toBe('UNKNOWN');
  });

  it('is LIMITED with exactly one supporting entity', () => {
    const { s, projects, edges } = setup(1);
    const r = computeSkillStrength(graphOf({ skills: [s], projects, edges }), s.id, NOW);
    expect(r.level).toBe('LIMITED');
    expect(r.supportingEntities).toEqual([
      { type: 'PROJECT', id: projects[0]!.id, name: 'P0' },
    ]);
  });

  it('is MODERATE with two entities and no verified evidence', () => {
    const { s, projects, edges } = setup(2);
    const r = computeSkillStrength(graphOf({ skills: [s], projects, edges }), s.id, NOW);
    expect(r.level).toBe('MODERATE');
    expect(r.quality).toBe('NONE');
  });

  it('is STRONG only with 3 entities, verified evidence, and recent activity', () => {
    const { s, projects, edges } = setup(3);
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      projects,
      evidence: [ev],
      edges: [
        ...edges,
        edge(['EVIDENCE', ev.id], ['PROJECT', projects[0]!.id], 'SUPPORTS'),
      ],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('STRONG');
    expect(r.verifiedEvidenceCount).toBe(1);
    expect(r.quality).toBe('VERIFIED');
    expect(r.latestActivity).toBe('2026-03-01');
    expect(r.monthsSinceLatest).toBe(3);
    expect(r.recency).toBe('CURRENT');
  });

  it('stays MODERATE with 3 entities but no verified evidence', () => {
    const { s, projects, edges } = setup(3);
    const ev = evidence({ verificationState: 'USER_PROVIDED' });
    const g = graphOf({
      skills: [s],
      projects,
      evidence: [ev],
      edges: [...edges, edge(['EVIDENCE', ev.id], ['SKILL', s.id], 'SUPPORTS')],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('MODERATE');
    expect(r.quality).toBe('UNVERIFIED');
    expect(r.reasons.join(' ')).toMatch(/verified piece of evidence/);
  });

  it('is not STRONG when the latest activity is older than 36 months', () => {
    const { s, projects, edges } = setup(3, { end: '2021-01-01' });
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      projects,
      evidence: [ev],
      edges: [...edges, edge(['EVIDENCE', ev.id], ['SKILL', s.id], 'SUPPORTS')],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('MODERATE');
    expect(r.recency).toBe('DATED');
    expect(r.monthsSinceLatest).toBe(65);
  });

  it('treats an ongoing project (start date, no end) as current activity', () => {
    const { s, projects, edges } = setup(1, { end: null });
    const r = computeSkillStrength(graphOf({ skills: [s], projects, edges }), s.id, NOW);
    expect(r.recency).toBe('CURRENT');
    expect(r.latestActivity).toBe('2026-06-15');
  });

  it('does not count evidence as verified when its link is only AI-suggested', () => {
    const { s, projects, edges } = setup(3);
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      projects,
      evidence: [ev],
      edges: [
        ...edges,
        edge(['EVIDENCE', ev.id], ['SKILL', s.id], 'SUPPORTS', 'AI_GENERATED'),
      ],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.evidenceCount).toBe(1);
    expect(r.verifiedEvidenceCount).toBe(0);
    expect(r.level).toBe('MODERATE');
  });

  it('caps at LIMITED when every supporting edge is inferred or AI-generated', () => {
    const { s, projects, edges } = setup(4, { state: 'INFERRED' });
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      projects,
      evidence: [ev],
      edges: [...edges, edge(['EVIDENCE', ev.id], ['SKILL', s.id], 'SUPPORTS')],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('LIMITED');
    expect(r.supportingEntities).toHaveLength(4);
    expect(r.reasons.join(' ')).toMatch(/inferred or AI-suggested/);
  });

  it('lifts the cap once one edge is user-confirmed', () => {
    const { s, projects, edges } = setup(2, { state: 'INFERRED' });
    const confirmed = [
      edges[0]!,
      { ...edges[1]!, verificationState: 'USER_PROVIDED' as const },
    ];
    const r = computeSkillStrength(
      graphOf({ skills: [s], projects, edges: confirmed }),
      s.id,
      NOW,
    );
    expect(r.level).toBe('MODERATE');
  });

  it('counts distinct entities once and collects evidence via entities, deduplicated', () => {
    const s = skill();
    const p = project({ startDate: '2025-01-01', endDate: '2025-06-01' });
    const a = achievement({ occurredOn: '2025-07-01' });
    const st = story();
    const ev = evidence({ verificationState: 'VERIFIED' });
    const g = graphOf({
      skills: [s],
      projects: [p],
      achievements: [a],
      stories: [st],
      evidence: [ev],
      edges: [
        edge(['PROJECT', p.id], ['SKILL', s.id], 'DEMONSTRATES'),
        edge(['PROJECT', p.id], ['SKILL', s.id], 'USES'),
        edge(['ACHIEVEMENT', a.id], ['SKILL', s.id], 'DEMONSTRATES'),
        edge(['STORY', st.id], ['SKILL', s.id], 'DEMONSTRATES'),
        edge(['EVIDENCE', ev.id], ['PROJECT', p.id], 'SUPPORTS'),
        edge(['EVIDENCE', ev.id], ['ACHIEVEMENT', a.id], 'SUPPORTS'),
      ],
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.supportingEntities).toHaveLength(3);
    expect(r.evidenceCount).toBe(1);
    expect(r.level).toBe('STRONG');
    expect(r.latestActivity).toBe('2025-07-01');
  });

  it('exposes renderable rules', () => {
    expect(SKILL_STRENGTH_RULES.levels.map((l) => l.level)).toEqual([
      'NONE',
      'LIMITED',
      'MODERATE',
      'STRONG',
    ]);
  });
});

describe('computeAllSkillStrengths', () => {
  it('sorts strongest first with deterministic tie-breaks', () => {
    const a = skill({ name: 'Zeta' });
    const b = skill({ name: 'Alpha' });
    const c = skill({ name: 'Mid' });
    const projects = [project({ name: 'x' }), project({ name: 'y' })];
    const g: EvidenceGraphData = graphOf({
      skills: [a, b, c],
      projects,
      edges: [
        edge(['PROJECT', projects[0]!.id], ['SKILL', c.id], 'USES'),
        edge(['PROJECT', projects[1]!.id], ['SKILL', c.id], 'USES'),
        edge(['PROJECT', projects[0]!.id], ['SKILL', a.id], 'USES'),
      ],
    });
    const ranked = computeAllSkillStrengths(g, NOW).map((r) => [
      r.skill.name,
      r.strength.level,
    ]);
    expect(ranked).toEqual([
      ['Mid', 'MODERATE'],
      ['Zeta', 'LIMITED'],
      ['Alpha', 'NONE'],
    ]);
  });
});

describe('evidenceCoverage', () => {
  it('reports share and named gaps', () => {
    const p1 = project({ name: 'Covered' });
    const p2 = project({ name: 'Bare' });
    const a = achievement({ title: 'Shipped it' });
    const st = story({ title: 'Hard call' });
    const ev = evidence();
    const g = graphOf({
      projects: [p1, p2],
      achievements: [a],
      stories: [st],
      evidence: [ev],
      edges: [
        edge(['EVIDENCE', ev.id], ['PROJECT', p1.id], 'SUPPORTS'),
        edge(['EVIDENCE', ev.id], ['ACHIEVEMENT', a.id], 'SUPPORTS'),
      ],
    });
    const c = evidenceCoverage(g);
    expect(c.total).toBe(4);
    expect(c.covered).toBe(2);
    expect(c.ratio).toBe(0.5);
    expect(c.byType.PROJECT).toEqual({ total: 2, covered: 1 });
    expect(c.gaps.map((x) => x.message)).toEqual([
      'project "Bare" has no evidence',
      'story "Hard call" has no evidence',
    ]);
  });
  it('has a null ratio for an empty graph', () => {
    expect(evidenceCoverage(graphOf({})).ratio).toBeNull();
  });
});
