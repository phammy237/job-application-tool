import {
  emptyEvidenceGraph,
  type EvidenceGraphData,
  type MyosEdge,
} from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { projectDetailView } from './detail-helpers';
import { filterProjects, summarizeProjects } from './list-helpers';

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';

function edge(over: Partial<MyosEdge>): MyosEdge {
  return {
    id: crypto.randomUUID(),
    userId: 'u',
    fromType: 'PROJECT',
    fromId: P,
    toType: 'SKILL',
    toId: S,
    relation: 'DEMONSTRATES',
    verificationState: 'USER_PROVIDED',
    confidence: null,
    note: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

function graph(): EvidenceGraphData {
  const g = emptyEvidenceGraph();
  g.projects = [
    {
      id: P,
      name: 'Alpha',
      description: null,
      summary: null,
      role: 'Lead',
      startDate: null,
      endDate: null,
      url: null,
      tags: [],
      status: 'ACTIVE',
      collaborators: [],
      talkingPoints: [],
      origin: 'GITHUB',
      visibility: 'PRIVATE',
      userApproved: false,
      approvedForApplications: false,
    },
  ];
  g.skills = [
    {
      id: S,
      name: 'TypeScript',
      category: null,
      visibility: 'PRIVATE',
      userApproved: true,
      approvedForApplications: false,
    },
  ];
  g.evidence = [
    {
      id: E,
      userId: 'u',
      sourceType: 'USER_NOTE',
      sourceRef: null,
      sourceUrl: null,
      title: 'Note',
      excerpt: 'x',
      occurredAt: null,
      confidence: null,
      verificationState: 'USER_PROVIDED',
      visibility: 'PRIVATE',
      metadata: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ];
  g.edges = [
    edge({}),
    edge({
      fromType: 'EVIDENCE',
      fromId: E,
      toType: 'PROJECT',
      toId: P,
      relation: 'SUPPORTS',
    }),
  ];
  return g;
}

describe('summarizeProjects / filterProjects', () => {
  it('counts skills and evidence', () => {
    const [row] = summarizeProjects(graph());
    expect(row).toMatchObject({ skillCount: 1, evidenceCount: 1, origin: 'GITHUB' });
  });
  it('filters by status and text', () => {
    const rows = summarizeProjects(graph());
    expect(filterProjects(rows, { status: 'IDEA' })).toHaveLength(0);
    expect(filterProjects(rows, { status: 'ACTIVE', q: 'alp' })).toHaveLength(1);
    expect(filterProjects(rows, { q: 'lead' })).toHaveLength(1);
    expect(filterProjects(rows, { q: 'zzz' })).toHaveLength(0);
  });
});

describe('projectDetailView', () => {
  it('returns null for unknown project', () => {
    expect(projectDetailView(graph(), S)).toBeNull();
  });
  it('slices skills and evidence', () => {
    const v = projectDetailView(graph(), P);
    expect(v?.skills.map((s) => s.skill.name)).toEqual(['TypeScript']);
    expect(v?.evidence.map((e) => e.item.id)).toEqual([E]);
  });
});
