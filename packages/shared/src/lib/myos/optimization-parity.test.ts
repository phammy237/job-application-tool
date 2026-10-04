import { describe, expect, it } from 'vitest';
import {
  analyzeBullet,
  checkBulletAgainstEvidence,
  findEvidenceForBullet,
} from './bullet-evidence';
import { buildGraphIndex } from './graph';
import { buildInterviewPrep } from './interview-prep';
import { buildSupportIndex, matchRequirementsToEvidence } from './match-requirements';
import {
  achievement,
  edge,
  evidence,
  graphOf,
  project,
  skill,
  story,
} from './retrieval-fixtures';
import { computeAllSkillStrengths, computeSkillStrength } from './skill-strength';
import { findTechnologies } from './tech-dictionary';
import { detectCompetencies } from './text';

/**
 * The performance work (shared indexes, pre-tokenized matching, per-call mention memo)
 * must be invisible: every optimized path returns exactly what the unoptimized path returns.
 */

const NOW = new Date('2026-06-01T00:00:00Z');

function fixture() {
  const py = skill({ name: 'Python' });
  const pg = skill({ name: 'PostgreSQL' });
  const pm = skill({ name: 'Product Management', userApproved: false });
  const p1 = project({
    name: 'Planner',
    description: 'Scheduling app in Python with a Postgres database, used by 200 users.',
    startDate: '2025-01-01',
  });
  const p2 = project({
    name: 'Ledger',
    description: 'Data pipelines in Python and stakeholder management.',
    startDate: '2024-02-01',
    endDate: '2024-09-01',
  });
  const a1 = achievement({
    title: 'Cut latency',
    metricText: 'Reduced p95 latency by 40%',
    projectId: p1.id,
  });
  const s1 = story({
    title: 'Prioritizing the roadmap',
    action: 'Prioritized the backlog with stakeholders',
    competencies: ['PRIORITIZATION'],
  });
  const ev1 = evidence({
    title: 'Planner repo',
    excerpt: 'Python 3.12 and PostgreSQL 16',
  });
  const ev2 = evidence({ title: 'Ledger notes', excerpt: 'nothing technical here' });
  const supports = (e: ReturnType<typeof edge>) => ({
    ...e,
    relation: 'SUPPORTS' as const,
  });
  return graphOf({
    projects: [p1, p2],
    skills: [py, pg, pm],
    achievements: [a1],
    stories: [s1],
    evidence: [ev1, ev2],
    edges: [
      edge('PROJECT', p1.id, 'SKILL', py.id),
      edge('PROJECT', p1.id, 'SKILL', pg.id),
      edge('PROJECT', p2.id, 'SKILL', py.id, 'INFERRED'),
      edge('PROJECT', p2.id, 'SKILL', pm.id),
      supports(edge('EVIDENCE', ev1.id, 'PROJECT', p1.id, 'VERIFIED')),
      supports(edge('EVIDENCE', ev2.id, 'PROJECT', p2.id)),
      supports(edge('EVIDENCE', ev1.id, 'SKILL', pg.id)),
    ],
  });
}

describe('optimization parity', () => {
  it('computeAllSkillStrengths with a prebuilt index equals per-skill computation', () => {
    const g = fixture();
    const shared = computeAllSkillStrengths(g, NOW, buildGraphIndex(g));
    expect(shared).toEqual(computeAllSkillStrengths(g, NOW));
    for (const row of shared) {
      expect(row.strength).toEqual(computeSkillStrength(g, row.skill.id, NOW));
    }
  });

  it('requirement matching is identical with a shared support index', () => {
    const g = fixture();
    const reqs = [
      { id: 'r1', text: '3+ years of Python and PostgreSQL' },
      { id: 'r2', text: 'Product management experience', category: 'PREFERRED' as const },
      { id: 'r3', text: 'Experience with LLMs' },
    ];
    const index = buildSupportIndex(g);
    const once = matchRequirementsToEvidence(g, reqs, NOW, index);
    expect(once).toEqual(matchRequirementsToEvidence(g, reqs, NOW));
    // Reusing the same index object a second time (token memo warm) gives the same answer.
    expect(matchRequirementsToEvidence(g, reqs, NOW, index)).toEqual(once);
  });

  it('interview prep is identical with a shared support index', () => {
    const g = fixture();
    const job = {
      title: 'Product Manager',
      description: 'Prioritize the roadmap with stakeholders. Python is a plus.',
      requirements: ['Prioritization across teams', 'SQL and Python'],
    };
    expect(buildInterviewPrep(g, job, NOW, buildSupportIndex(g))).toEqual(
      buildInterviewPrep(g, job, NOW),
    );
  });

  it('analyzeBullet matches findEvidenceForBullet + checkBulletAgainstEvidence', () => {
    const g = fixture();
    const index = buildSupportIndex(g);
    for (const bullet of [
      'Built a scheduling app in Python and PostgreSQL used by 200 users',
      'Reduced p95 latency by 40% using Kubernetes',
      'Doubled revenue with Rust',
      'Unrelated sentence',
    ]) {
      const both = analyzeBullet(g, bullet, index);
      expect(both.evidence).toEqual(findEvidenceForBullet(g, bullet));
      expect(both.check).toEqual(checkBulletAgainstEvidence(g, bullet));
    }
  });

  it('findTechnologies keeps case-insensitive and strict-alias behaviour', () => {
    expect(
      findTechnologies('POSTGRES and NEXT.JS on K8S').map((m) => m.canonical),
    ).toEqual(['PostgreSQL', 'Next.js', 'Kubernetes']);
    expect(findTechnologies('written in Go, Rust').map((m) => m.canonical)).toEqual([
      'Go',
      'Rust',
    ]);
    expect(findTechnologies('written in go, rust').map((m) => m.canonical)).toEqual([
      'Rust',
    ]);
    expect(findTechnologies('Go to the store')).toEqual([]);
  });

  it('detectCompetencies keeps whole-word and prefix keyword rules', () => {
    expect(
      detectCompetencies('Mentoring juniors and collaborating cross-functionally'),
    ).toEqual(['LEADERSHIP', 'CROSS_FUNCTIONAL_COLLABORATION']);
    expect(detectCompetencies('leaderboard')).toEqual([]);
  });
});
