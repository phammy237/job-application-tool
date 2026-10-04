import type {
  EdgeRelation,
  MyosAchievement,
  MyosEdge,
  MyosEvidence,
  MyosStory,
  NodeType,
  VerificationState,
  Visibility,
} from '../../schemas/myos';
import {
  emptyEvidenceGraph,
  type EvidenceGraphData,
  type GraphProject,
  type GraphSkill,
} from './graph-types';

/** Test-only builders (not exported from the package index). Deterministic ids from a counter. */
let counter = 0;
export function uid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

const USER = '11111111-1111-4111-8111-111111111111';
const TS = '2026-01-01T00:00:00.000Z';

export function project(over: Partial<GraphProject> = {}): GraphProject {
  return {
    id: uid(),
    name: 'Project',
    description: null,
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

export function skill(over: Partial<GraphSkill> = {}): GraphSkill {
  return {
    id: uid(),
    name: 'Skill',
    category: null,
    visibility: 'PRIVATE',
    userApproved: true,
    approvedForApplications: true,
    ...over,
  };
}

export function evidence(over: Partial<MyosEvidence> = {}): MyosEvidence {
  return {
    id: uid(),
    userId: USER,
    sourceType: 'LINK',
    sourceRef: null,
    sourceUrl: null,
    title: 'Evidence',
    excerpt: null,
    occurredAt: null,
    confidence: null,
    verificationState: 'USER_PROVIDED',
    visibility: 'PRIVATE',
    metadata: {},
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function achievement(over: Partial<MyosAchievement> = {}): MyosAchievement {
  return {
    id: uid(),
    userId: USER,
    title: 'Achievement',
    description: null,
    kind: 'ACHIEVEMENT',
    occurredOn: null,
    metricText: null,
    projectId: null,
    experienceId: null,
    verificationState: 'USER_PROVIDED',
    userApproved: true,
    visibility: 'PRIVATE',
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function story(over: Partial<MyosStory> = {}): MyosStory {
  return {
    id: uid(),
    userId: USER,
    title: 'Story',
    situation: null,
    task: null,
    action: null,
    result: null,
    competencies: [],
    themes: [],
    verificationState: 'USER_PROVIDED',
    userApproved: true,
    visibility: 'PRIVATE',
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function edge(
  from: [NodeType, string],
  to: [NodeType, string],
  relation: EdgeRelation,
  verificationState: VerificationState = 'USER_PROVIDED',
): MyosEdge {
  return {
    id: uid(),
    userId: USER,
    fromType: from[0],
    fromId: from[1],
    toType: to[0],
    toId: to[1],
    relation,
    verificationState,
    confidence: null,
    note: null,
    createdAt: TS,
  };
}

export function graphOf(parts: Partial<EvidenceGraphData>): EvidenceGraphData {
  return { ...emptyEvidenceGraph(), ...parts };
}

export const PUBLIC: Visibility = 'PUBLIC';
