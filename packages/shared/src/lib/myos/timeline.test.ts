import { describe, expect, it } from 'vitest';
import { achievement, edge, evidence, graphOf, project, skill } from './graph-fixtures';
import { buildTimeline } from './timeline';
import type { GraphEducation, GraphExperience } from './graph-types';

const NOW = new Date('2026-06-15T00:00:00.000Z');

const exp = (over: Partial<GraphExperience>): GraphExperience => ({
  id: '22222222-2222-4222-8222-222222222222',
  company: 'Acme',
  title: 'Engineer',
  startDate: '2022-01-01',
  endDate: '2023-06-01',
  description: null,
  tags: [],
  visibility: 'PRIVATE',
  userApproved: true,
  approvedForApplications: true,
  ...over,
});
const edu = (over: Partial<GraphEducation>): GraphEducation => ({
  id: '33333333-3333-4333-8333-333333333333',
  school: 'State U',
  degree: 'BS',
  fieldOfStudy: 'CS',
  startDate: '2020-09-01',
  graduationDate: '2024-05-01',
  honors: [],
  userApproved: true,
  ...over,
});

function build() {
  const sk = skill({ name: 'Python' });
  const p = project({
    name: 'Career OS',
    startDate: '2025-01-01',
    endDate: null,
    status: 'ACTIVE',
  });
  const old = project({
    name: 'Old thing',
    startDate: '2021-03-01',
    endDate: '2021-08-01',
    status: 'COMPLETED',
  });
  const nodate = project({ name: 'Mystery' });
  const award = achievement({
    title: 'Hackathon win',
    kind: 'AWARD',
    occurredOn: '2023-11-05',
  });
  const metric = achievement({
    title: 'Cut latency',
    kind: 'METRIC',
    occurredOn: '2025-09-01',
    projectId: p.id,
  });
  const undatedA = achievement({ title: 'Undated kudos' });
  const ev = evidence({ verificationState: 'VERIFIED' });
  const g = graphOf({
    skills: [sk],
    projects: [p, old, nodate],
    experiences: [exp({})],
    education: [edu({})],
    achievements: [award, metric, undatedA],
    evidence: [ev],
    edges: [
      edge(['PROJECT', p.id], ['SKILL', sk.id], 'DEMONSTRATES'),
      edge(['PROJECT', old.id], ['SKILL', sk.id], 'USES'),
      edge(['EVIDENCE', ev.id], ['PROJECT', p.id], 'SUPPORTS', 'VERIFIED'),
      edge(['ACHIEVEMENT', metric.id], ['PROJECT', p.id], 'BELONGS_TO'),
    ],
  });
  return { g, sk, p, old, nodate, award, metric, undatedA };
}

describe('buildTimeline', () => {
  it('orders newest first with ongoing work on top and maps achievement kinds', () => {
    const { g } = build();
    const t = buildTimeline(g, { now: NOW });
    expect(t.entries.map((e) => `${e.type}:${e.title}`)).toEqual([
      'PROJECT:Career OS',
      'ACHIEVEMENT:Cut latency',
      'EDUCATION:State U',
      'AWARD:Hackathon win',
      'WORK:Engineer',
      'PROJECT:Old thing',
    ]);
  });

  it('puts dateless entries in undated instead of dropping them', () => {
    const { g } = build();
    const t = buildTimeline(g, { now: NOW });
    expect(t.undated.map((e) => e.title)).toEqual(['Mystery', 'Undated kudos']);
    expect(t.entries.length + t.undated.length).toBe(8);
  });

  it('fills ongoing, skills, evidence count, hrefs, and verification', () => {
    const { g, p } = build();
    const e = buildTimeline(g, { now: NOW }).entries.find(
      (x) => x.title === 'Career OS',
    )!;
    expect(e).toMatchObject({
      id: `PROJECT:${p.id}`,
      isOngoing: true,
      relatedSkillNames: ['Python'],
      evidenceCount: 1,
      verificationState: 'VERIFIED',
      href: `/my/projects/${p.id}`,
      subtitle: 'ACTIVE',
    });
  });

  it('uses the linked project as an achievement subtitle', () => {
    const { g } = build();
    const e = buildTimeline(g, { now: NOW }).entries.find(
      (x) => x.title === 'Cut latency',
    )!;
    expect(e.subtitle).toBe('Career OS');
  });

  it('filters by type', () => {
    const { g } = build();
    const t = buildTimeline(g, { now: NOW, types: ['AWARD', 'WORK'] });
    expect(t.entries.map((e) => e.type).sort()).toEqual(['AWARD', 'WORK']);
    expect(t.undated).toEqual([]);
  });

  it('filters by year using date-range overlap', () => {
    const { g } = build();
    const t = buildTimeline(g, { now: NOW, year: 2023 });
    expect(t.entries.map((e) => e.title).sort()).toEqual([
      'Engineer',
      'Hackathon win',
      'State U',
    ]);
    // the ongoing 2025+ project only overlaps years from its start to now
    expect(
      buildTimeline(g, { now: NOW, year: 2026 }).entries.map((e) => e.title),
    ).toContain('Career OS');
    expect(
      buildTimeline(g, { now: NOW, year: 2024 }).entries.map((e) => e.title),
    ).not.toContain('Career OS');
  });

  it('filters by skill id', () => {
    const { g, sk } = build();
    const t = buildTimeline(g, { now: NOW, skillId: sk.id });
    expect(t.entries.map((e) => e.title)).toEqual(['Career OS', 'Old thing']);
    expect(t.undated).toEqual([]);
  });

  it('treats future graduation as ongoing education', () => {
    const g = graphOf({ education: [edu({ graduationDate: '2027-05-01' })] });
    expect(buildTimeline(g, { now: NOW }).entries[0]!.isOngoing).toBe(true);
  });
});
