import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * The common shape packages/ai's retrieval/ranking pipeline scores against, regardless of
 * which of the five source tables a fact came from. `text` is the normalized blob used both
 * for keyword-overlap scoring and as the literal content sent to Claude.
 */
export interface ApprovedFactForGeneration {
  id: string;
  sourceTable: 'candidate_facts' | 'experiences' | 'education' | 'projects' | 'skills';
  category: string | null;
  text: string;
  tags: string[];
  recencyDate: string | null;
  /** true when the record has a start date but no end date (a current role/project) —
   * scored as maximally recent regardless of how long ago it started. */
  isOngoing: boolean;
}

type CandidateFactRow = Database['public']['Tables']['candidate_facts']['Row'];
type ExperienceRow = Database['public']['Tables']['experiences']['Row'];
type EducationRow = Database['public']['Tables']['education']['Row'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];
type SkillRow = Database['public']['Tables']['skills']['Row'];

function joinNonEmpty(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
}

/**
 * The single enforcement point for docs/AI_GROUNDING.md §6's data-minimization rule: only
 * facts with `user_approved = true AND approved_for_applications = true` are eligible for
 * retrieval. packages/ai calls only this function to source candidate content — it never
 * queries candidate_facts/experiences/education/projects/skills directly, so an unapproved
 * fact structurally cannot reach the prompt-construction step.
 */
export async function listOwnApprovedFactsForGeneration(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<ApprovedFactForGeneration[]> {
  const [factsRes, experiencesRes, educationRes, projectsRes, skillsRes] = await Promise.all([
    supabase
      .from('candidate_facts')
      .select('*')
      .eq('user_id', userId)
      .eq('user_approved', true)
      .eq('approved_for_applications', true),
    supabase
      .from('experiences')
      .select('*')
      .eq('user_id', userId)
      .eq('user_approved', true)
      .eq('approved_for_applications', true),
    supabase
      .from('education')
      .select('*')
      .eq('user_id', userId)
      .eq('user_approved', true)
      .eq('approved_for_applications', true),
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .eq('user_approved', true)
      .eq('approved_for_applications', true),
    supabase
      .from('skills')
      .select('*')
      .eq('user_id', userId)
      .eq('user_approved', true)
      .eq('approved_for_applications', true),
  ]);

  assertNoError(factsRes.error, 'listOwnApprovedFactsForGeneration (candidate_facts)');
  assertNoError(experiencesRes.error, 'listOwnApprovedFactsForGeneration (experiences)');
  assertNoError(educationRes.error, 'listOwnApprovedFactsForGeneration (education)');
  assertNoError(projectsRes.error, 'listOwnApprovedFactsForGeneration (projects)');
  assertNoError(skillsRes.error, 'listOwnApprovedFactsForGeneration (skills)');

  const facts: ApprovedFactForGeneration[] = [];

  for (const row of (factsRes.data ?? []) as CandidateFactRow[]) {
    facts.push({
      id: row.id,
      sourceTable: 'candidate_facts',
      category: row.category,
      text: joinNonEmpty([row.title, row.normalized_value]),
      tags: row.tags ?? [],
      recencyDate: null,
      isOngoing: false,
    });
  }

  for (const row of (experiencesRes.data ?? []) as ExperienceRow[]) {
    facts.push({
      id: row.id,
      sourceTable: 'experiences',
      category: 'EXPERIENCE',
      text: joinNonEmpty([row.title, row.company, row.description]),
      tags: row.tags ?? [],
      recencyDate: row.end_date ?? row.start_date,
      isOngoing: Boolean(row.start_date) && !row.end_date,
    });
  }

  for (const row of (educationRes.data ?? []) as EducationRow[]) {
    facts.push({
      id: row.id,
      sourceTable: 'education',
      category: 'EDUCATION',
      text: joinNonEmpty([row.school, row.degree, row.field_of_study]),
      tags: [],
      recencyDate: row.graduation_date ?? row.start_date,
      isOngoing: Boolean(row.start_date) && !row.graduation_date,
    });
  }

  for (const row of (projectsRes.data ?? []) as ProjectRow[]) {
    facts.push({
      id: row.id,
      sourceTable: 'projects',
      category: 'PROJECT',
      text: joinNonEmpty([row.name, row.role, row.description]),
      tags: row.tags ?? [],
      recencyDate: row.end_date ?? row.start_date,
      isOngoing: Boolean(row.start_date) && !row.end_date,
    });
  }

  for (const row of (skillsRes.data ?? []) as SkillRow[]) {
    facts.push({
      id: row.id,
      sourceTable: 'skills',
      category: 'SKILL',
      text: joinNonEmpty([row.name, row.category]),
      tags: [],
      recencyDate: null,
      isOngoing: false,
    });
  }

  return facts;
}
