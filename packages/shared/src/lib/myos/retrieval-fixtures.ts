import type {
  MyosAchievement,
  MyosEdge,
  MyosEvidence,
  MyosStory,
  NodeType,
  VerificationState,
} from '../../schemas/myos';
import type {
  EvidenceGraphData,
  GraphExperience,
  GraphProject,
  GraphSkill,
} from './graph-types';
import { emptyEvidenceGraph } from './graph-types';

/** Test-only builders for the retrieval modules (match, ask, interview prep, bullet grounding). */
let n = 0;
export function fid(prefix: string): string {
  n += 1;
  return `${prefix}-${n}`;
}

const TS = '2026-01-01T00:00:00.000Z';

export function project(over: Partial<GraphProject> & { name: string }): GraphProject {
  return {
    id: fid('proj'),
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

export function skill(over: Partial<GraphSkill> & { name: string }): GraphSkill {
  return {
    id: fid('skill'),
    category: null,
    visibility: 'PRIVATE',
    userApproved: true,
    approvedForApplications: true,
    ...over,
  };
}

export function experience(
  over: Partial<GraphExperience> & { title: string; company: string },
): GraphExperience {
  return {
    id: fid('exp'),
    startDate: null,
    endDate: null,
    description: null,
    tags: [],
    visibility: 'PRIVATE',
    userApproved: true,
    approvedForApplications: true,
    ...over,
  };
}

export function achievement(over: Partial<MyosAchievement> & { title: string }): MyosAchievement {
  return {
    id: fid('ach'),
    userId: 'u',
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

export function story(over: Partial<MyosStory> & { title: string }): MyosStory {
  return {
    id: fid('story'),
    userId: 'u',
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

export function evidence(over: Partial<MyosEvidence> & { title: string }): MyosEvidence {
  return {
    id: fid('ev'),
    userId: 'u',
    sourceType: 'USER_NOTE',
    sourceRef: null,
    sourceUrl: null,
    excerpt: null,
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

export function edge(
  fromType: NodeType,
  fromId: string,
  toType: NodeType,
  toId: string,
  state: VerificationState = 'USER_PROVIDED',
): MyosEdge {
  return {
    id: fid('edge'),
    userId: 'u',
    fromType,
    fromId,
    toType,
    toId,
    relation: 'USES',
    verificationState: state,
    confidence: null,
    note: null,
    createdAt: TS,
  };
}

export function graphOf(parts: Partial<EvidenceGraphData>): EvidenceGraphData {
  return { ...emptyEvidenceGraph(), ...parts };
}
