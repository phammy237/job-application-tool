import {
  projectOriginSchema,
  projectStatusSchema,
  visibilitySchema,
  type EvidenceGraphData,
  type GraphEducation,
  type GraphExperience,
  type GraphProject,
  type GraphSkill,
  type Visibility,
} from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  rowToAchievement,
  rowToEdge,
  rowToEvidence,
  rowToStory,
} from './myos-mappers';

type Tables = Database['public']['Tables'];

/** Rows predating the visibility column (or older generated types) default to PRIVATE. */
function visibilityOf(value: string | null | undefined): Visibility {
  const parsed = visibilitySchema.safeParse(value);
  return parsed.success ? parsed.data : 'PRIVATE';
}

function toProject(row: Tables['projects']['Row']): GraphProject {
  const status = projectStatusSchema.safeParse(row.status);
  const origin = projectOriginSchema.safeParse(row.origin);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    summary: row.summary ?? null,
    role: row.role,
    startDate: row.start_date,
    endDate: row.end_date,
    url: row.url,
    tags: row.tags ?? [],
    status: status.success ? status.data : null,
    collaborators: row.collaborators ?? [],
    talkingPoints: row.talking_points ?? [],
    origin: origin.success ? origin.data : 'MANUAL',
    visibility: visibilityOf(row.visibility),
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
  };
}

function toSkill(row: Tables['skills']['Row']): GraphSkill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    visibility: visibilityOf(row.visibility),
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
  };
}

function toExperience(row: Tables['experiences']['Row']): GraphExperience {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    description: row.description,
    tags: row.tags ?? [],
    visibility: visibilityOf(row.visibility),
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
  };
}

function toEducation(row: Tables['education']['Row']): GraphEducation {
  return {
    id: row.id,
    school: row.school,
    degree: row.degree,
    fieldOfStudy: row.field_of_study,
    startDate: row.start_date,
    graduationDate: row.graduation_date,
    honors: row.honors ?? [],
    userApproved: row.user_approved,
  };
}

/**
 * Loads the caller's entire evidence graph in one parallel round-trip. Every query is scoped to
 * `userId`. Returns ALL visibilities — this is the owner's view; anything leaving Career OS must
 * be filtered by the pure portfolio logic afterwards, never by this loader.
 */
export async function loadOwnEvidenceGraph(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<EvidenceGraphData> {
  const [projects, skills, experiences, education, achievements, stories, evidence, edges] =
    await Promise.all([
      supabase.from('projects').select('*').eq('user_id', userId),
      supabase.from('skills').select('*').eq('user_id', userId),
      supabase.from('experiences').select('*').eq('user_id', userId),
      supabase.from('education').select('*').eq('user_id', userId),
      supabase.from('myos_achievements').select('*').eq('user_id', userId),
      supabase.from('myos_stories').select('*').eq('user_id', userId),
      supabase.from('myos_evidence').select('*').eq('user_id', userId),
      supabase.from('myos_edges').select('*').eq('user_id', userId),
    ]);

  assertNoError(projects.error, 'loadOwnEvidenceGraph.projects');
  assertNoError(skills.error, 'loadOwnEvidenceGraph.skills');
  assertNoError(experiences.error, 'loadOwnEvidenceGraph.experiences');
  assertNoError(education.error, 'loadOwnEvidenceGraph.education');
  assertNoError(achievements.error, 'loadOwnEvidenceGraph.achievements');
  assertNoError(stories.error, 'loadOwnEvidenceGraph.stories');
  assertNoError(evidence.error, 'loadOwnEvidenceGraph.evidence');
  assertNoError(edges.error, 'loadOwnEvidenceGraph.edges');

  return {
    projects: (projects.data ?? []).map(toProject),
    skills: (skills.data ?? []).map(toSkill),
    experiences: (experiences.data ?? []).map(toExperience),
    education: (education.data ?? []).map(toEducation),
    achievements: (achievements.data ?? []).map(rowToAchievement),
    stories: (stories.data ?? []).map(rowToStory),
    evidence: (evidence.data ?? []).map(rowToEvidence),
    edges: (edges.data ?? []).map(rowToEdge),
  };
}
