import {
  emptyEvidenceGraph,
  type EvidenceGraphData,
  type GraphProject,
  type MyosEvidence,
} from '@career-os/shared';

/** Test-only helpers for web-layer myOS tests (not imported by app code). */
const TS = '2026-01-01T00:00:00.000Z';
const USER = '11111111-1111-4111-8111-111111111111';

export function testProject(over: Partial<GraphProject> = {}): GraphProject {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'Campus Planner',
    description: 'Built a scheduling app in React used by 500 students',
    summary: null,
    role: null,
    startDate: null,
    endDate: null,
    url: null,
    tags: [],
    status: null,
    collaborators: [],
    talkingPoints: [],
    origin: 'MANUAL',
    visibility: 'PRIVATE',
    userApproved: true,
    approvedForApplications: true,
    ...over,
  };
}

export function testEvidence(over: Partial<MyosEvidence> = {}): MyosEvidence {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    userId: USER,
    sourceType: 'LINK',
    sourceRef: null,
    sourceUrl: null,
    title: 'Launch retro',
    excerpt: 'Used by 500 students',
    occurredAt: null,
    confidence: null,
    verificationState: 'VERIFIED',
    visibility: 'PRIVATE',
    metadata: {},
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function testGraph(): EvidenceGraphData {
  const p = testProject();
  const ev = testEvidence();
  return {
    ...emptyEvidenceGraph(),
    projects: [p],
    evidence: [ev],
    edges: [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        userId: USER,
        fromType: 'PROJECT',
        fromId: p.id,
        toType: 'EVIDENCE',
        toId: ev.id,
        relation: 'SUPPORTS',
        verificationState: 'VERIFIED',
        confidence: null,
        note: null,
        createdAt: TS,
      },
    ],
  };
}
