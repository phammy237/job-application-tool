import { describe, expect, it } from 'vitest';
import { answerQuestion, classifyQuestion } from './ask';
import { emptyEvidenceGraph } from './graph-types';
import { matchRequirementsToEvidence } from './match-requirements';
import { computeSkillStrength } from './skill-strength';
import {
  edge as gEdge,
  evidence as gEvidence,
  graphOf as gGraphOf,
  project as gProject,
  skill as gSkill,
} from './graph-fixtures';
import { edge, evidence, graphOf, project, skill } from './retrieval-fixtures';

const NOW = new Date('2026-06-15T00:00:00.000Z');

describe('skill-specific evidence', () => {
  function kube(evOver: Parameters<typeof gEvidence>[0], attachTo: 'project' | 'skill' = 'project') {
    const s = gSkill({ name: 'Kubernetes' });
    const projects = [0, 1, 2].map((i) =>
      gProject({ name: `K${i}`, startDate: '2025-01-01', endDate: '2026-03-01' }),
    );
    const ev = gEvidence({ verificationState: 'VERIFIED', ...evOver });
    const edges = [
      ...projects.map((p) => gEdge(['PROJECT', p.id], ['SKILL', s.id], 'DEMONSTRATES', 'USER_PROVIDED')),
      gEdge(
        ['EVIDENCE', ev.id],
        attachTo === 'project' ? ['PROJECT', projects[0]!.id] : ['SKILL', s.id],
        'SUPPORTS',
        'VERIFIED',
      ),
    ];
    return { s, g: gGraphOf({ skills: [s], projects, evidence: [ev], edges }) };
  }

  it('does not reach STRONG on verified evidence that never mentions the skill', () => {
    const { s, g } = kube({
      sourceType: 'GITHUB_REPO',
      title: 'octo/website',
      excerpt: 'A personal website',
      metadata: { languages: ['TypeScript'], topics: ['nextjs'] },
    });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('MODERATE');
    expect(r.evidenceCount).toBe(0);
    expect(r.verifiedEvidenceCount).toBe(0);
    expect(r.quality).toBe('NONE');
    expect(r.reasons.join(' ')).toMatch(/not skill-specific/);
  });

  it('counts evidence on an entity when its topics mention a skill alias', () => {
    const { s, g } = kube({ title: 'octo/infra', metadata: { topics: ['k8s', 'helm'] } });
    const r = computeSkillStrength(g, s.id, NOW);
    expect(r.level).toBe('STRONG');
    expect(r.quality).toBe('VERIFIED');
  });

  it('counts evidence attached directly to the skill without a text match', () => {
    const { s, g } = kube({ title: 'Certificate' }, 'skill');
    expect(computeSkillStrength(g, s.id, NOW).level).toBe('STRONG');
  });

  it('does not match the skill name inside a longer word', () => {
    const { s, g } = kube({ title: 'kubernetesque notes' });
    expect(computeSkillStrength(g, s.id, NOW).level).toBe('MODERATE');
  });
});

describe('STRONG_FIT bar', () => {
  it('a posting where everything is only MODERATE is PARTIAL_FIT', () => {
    const py = skill({ name: 'Python' });
    const p1 = project({ name: 'A' });
    const p2 = project({ name: 'B' });
    const graph = graphOf({
      skills: [py],
      projects: [p1, p2],
      edges: [edge('PROJECT', p1.id, 'SKILL', py.id), edge('PROJECT', p2.id, 'SKILL', py.id)],
    });
    const r = matchRequirementsToEvidence(graph, [{ id: 'r', text: 'Python skills' }], NOW);
    expect(r.matches[0]!.level).toBe('MODERATE');
    expect(r.summary.overallVerdict).toBe('PARTIAL_FIT');
  });

  it('needs at least half the requirements at STRONG', () => {
    const py = skill({ name: 'Python' });
    const rs = skill({ name: 'Rust' });
    const p1 = project({ name: 'A' });
    const p2 = project({ name: 'B' });
    const ev = evidence({ title: 'README', verificationState: 'VERIFIED' });
    const graph = graphOf({
      skills: [py, rs],
      projects: [p1, p2],
      evidence: [ev],
      edges: [
        edge('PROJECT', p1.id, 'SKILL', py.id),
        edge('PROJECT', p2.id, 'SKILL', py.id),
        edge('PROJECT', p1.id, 'EVIDENCE', ev.id, 'VERIFIED'),
        edge('PROJECT', p1.id, 'SKILL', rs.id),
      ],
    });
    const r = matchRequirementsToEvidence(
      graph,
      [
        { id: 'a', text: 'Python skills' },
        { id: 'b', text: 'Rust experience' },
        { id: 'c', text: 'Rust systems' },
      ],
      NOW,
    );
    expect(r.summary.strong).toBe(1);
    expect(r.summary.overallVerdict).not.toBe('STRONG_FIT');
  });
});

describe('ask intent routing and weak areas', () => {
  const SAMPLES: [string, string][] = [
    ['What projects best demonstrate product management?', 'PROJECTS_FOR_TOPIC'],
    ['What evidence shows I can work cross-functionally?', 'SKILL_EVIDENCE'],
    ['Where have I used Python?', 'SKILL_EVIDENCE'],
    ['What should I talk about in a Microsoft PM interview?', 'INTERVIEW_PREP'],
    ['What is my strongest leadership example?', 'STORY_FOR_COMPETENCY'],
    ['Which projects demonstrate AI experience?', 'PROJECTS_FOR_TOPIC'],
    ['What evidence do I have for user research?', 'SKILL_EVIDENCE'],
    ['What areas of my profile are weak?', 'WEAK_AREAS'],
  ];
  it.each(SAMPLES)('routes %s', (q, intent) => {
    expect(classifyQuestion(q)).toBe(intent);
  });

  it('generic words do not hijack skill/topic questions', () => {
    expect(classifyQuestion('Where have I used Kubernetes in an interview setting?')).toBe('SKILL_EVIDENCE');
    expect(classifyQuestion('Which projects show Python skills I could improve?')).toBe('PROJECTS_FOR_TOPIC');
    expect(classifyQuestion('What evidence do I have for the missing data pipeline?')).toBe('SKILL_EVIDENCE');
    expect(classifyQuestion('Tell me about gap analysis')).toBe('GENERAL_SEARCH');
  });

  it('WEAK_AREAS only on explicit weakness phrasing', () => {
    for (const q of [
      'What are my weakest skills?',
      'What are the gaps in my profile?',
      'What am I missing?',
      'How can I improve my profile?',
    ]) {
      expect(classifyQuestion(q)).toBe('WEAK_AREAS');
    }
  });

  it('INTERVIEW_PREP when interview and no better intent', () => {
    expect(classifyQuestion('Help me prepare for my Google interview')).toBe('INTERVIEW_PREP');
  });

  it('weak areas is a valid answer on a non-empty graph and insufficient only when empty', () => {
    const r = answerQuestion(graphOf({ skills: [skill({ name: 'Rust' })] }), 'What are my weakest areas?', NOW);
    expect(r.intent).toBe('WEAK_AREAS');
    expect(r.insufficientEvidence).toBe(false);
    expect(r.claims.length).toBeGreaterThan(0);
    expect(answerQuestion(emptyEvidenceGraph(), 'What are my weakest areas?', NOW).insufficientEvidence).toBe(true);
  });
});
