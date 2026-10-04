import type {
  MyosAchievement,
  MyosEdge,
  MyosEvidence,
  MyosStory,
  ProjectStatus,
  Visibility,
} from '../../schemas/myos';

/**
 * Plain, already-validated rows the myOS pure logic (skill strength, graph, timeline, matching,
 * ask retrieval, portfolio filtering) operates on. Loaded in one call by
 * `loadOwnEvidenceGraph` (packages/database) and passed around as a value, so every algorithm
 * stays a pure, unit-testable function with no database access.
 *
 * Dates are ISO strings ("YYYY-MM-DD" or full datetimes) or null.
 */
export interface GraphProject {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  tags: string[];
  status: ProjectStatus | null;
  collaborators: string[];
  talkingPoints: string[];
  origin: 'MANUAL' | 'GITHUB' | 'RESUME';
  visibility: Visibility;
  userApproved: boolean;
  approvedForApplications: boolean;
}

export interface GraphSkill {
  id: string;
  name: string;
  category: string | null;
  visibility: Visibility;
  userApproved: boolean;
  approvedForApplications: boolean;
}

export interface GraphExperience {
  id: string;
  company: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  tags: string[];
  visibility: Visibility;
  userApproved: boolean;
  approvedForApplications: boolean;
}

export interface GraphEducation {
  id: string;
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  graduationDate: string | null;
  honors: string[];
  userApproved: boolean;
}

export interface EvidenceGraphData {
  projects: GraphProject[];
  skills: GraphSkill[];
  experiences: GraphExperience[];
  education: GraphEducation[];
  achievements: MyosAchievement[];
  stories: MyosStory[];
  evidence: MyosEvidence[];
  edges: MyosEdge[];
}

export function emptyEvidenceGraph(): EvidenceGraphData {
  return {
    projects: [],
    skills: [],
    experiences: [],
    education: [],
    achievements: [],
    stories: [],
    evidence: [],
    edges: [],
  };
}
