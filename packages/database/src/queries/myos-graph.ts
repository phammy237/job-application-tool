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

/**
 * Loads ONLY what the public portfolio export may contain, filtering at QUERY level:
 * projects/skills/achievements with visibility = 'PUBLIC' and user_approved = true, evidence with
 * visibility = 'PUBLIC', and edges whose both endpoints are in those loaded id sets. Private
 * nodes (and experiences, education, stories) are never selected at all. Callers still pass the
 * result through the pure `buildPortfolioExport` filter as a second line of defence.
 */
export async function loadPublicEvidenceGraph(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<EvidenceGraphData> {
  const [projects, skills, achievements, evidence] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .eq('visibility', 'PUBLIC')
      .eq('user_approved', true),
    supabase
      .from('skills')
      .select('*')
      .eq('user_id', userId)
      .eq('visibility', 'PUBLIC')
      .eq('user_approved', true),
    supabase
      .from('myos_achievements')
      .select('*')
      .eq('user_id', userId)
      .eq('visibility', 'PUBLIC')
      .eq('user_approved', true),
    supabase.from('myos_evidence').select('*').eq('user_id', userId).eq('visibility', 'PUBLIC'),
  ]);
  assertNoError(projects.error, 'loadPublicEvidenceGraph.projects');
  assertNoError(skills.error, 'loadPublicEvidenceGraph.skills');
  assertNoError(achievements.error, 'loadPublicEvidenceGraph.achievements');
  assertNoError(evidence.error, 'loadPublicEvidenceGraph.evidence');

  const projectRows = projects.data ?? [];
  const skillRows = skills.data ?? [];
  const achievementRows = achievements.data ?? [];
  const evidenceRows = evidence.data ?? [];

  const keys = new Set<string>([
    ...projectRows.map((r) => `PROJECT:${r.id}`),
    ...skillRows.map((r) => `SKILL:${r.id}`),
    ...achievementRows.map((r) => `ACHIEVEMENT:${r.id}`),
    ...evidenceRows.map((r) => `EVIDENCE:${r.id}`),
  ]);
  const ids = [...new Set([...keys].map((k) => k.slice(k.indexOf(':') + 1)))];

  let edgeRows: Tables['myos_edges']['Row'][] = [];
  if (ids.length > 0) {
    const edges = await supabase
      .from('myos_edges')
      .select('*')
      .eq('user_id', userId)
      .in('from_id', ids)
      .in('to_id', ids);
    assertNoError(edges.error, 'loadPublicEvidenceGraph.edges');
    // Type-aware endpoint check (ids alone could in theory collide across node types).
    edgeRows = (edges.data ?? []).filter(
      (e) => keys.has(`${e.from_type}:${e.from_id}`) && keys.has(`${e.to_type}:${e.to_id}`),
    );
  }

  return {
    projects: projectRows.map(toProject),
    skills: skillRows.map(toSkill),
    experiences: [],
    education: [],
    achievements: achievementRows.map(rowToAchievement),
    stories: [],
    evidence: evidenceRows.map(rowToEvidence),
    edges: edgeRows.map(rowToEdge),
  };
}
