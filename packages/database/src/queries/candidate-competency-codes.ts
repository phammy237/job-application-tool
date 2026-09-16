import { matchCompetencyConcepts } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';
import { listOwnCandidateFacts } from './candidate-facts';
import { listOwnEducation } from './education';
import { listOwnExperiences } from './experiences';
import { listOwnProjects } from './projects';
import { listOwnSkills } from './skills';

/**
 * Derives the D4 COMPETENCY_FIT candidate-side concept set from trusted, approved profile data
 * only (docs/JOB_DISCOVERY.md "Competency extraction") — the same grounding gate
 * docs/AI_GROUNDING.md defines for `packages/ai`, applied here even though this path makes zero
 * AI calls: `userApproved && approvedForApplications` on every source table. Skill *names* are
 * matched directly (they're already short, high-trust structured labels); experience/project
 * descriptions and candidate-fact normalized values are matched as free text through the exact
 * same `matchCompetencyConcepts` alias matcher a job description is run through, so "the
 * candidate has SQL" and "the posting asks for SQL" are compared on identical terms. A skill
 * education rows contribute nothing here — degree/school text isn't competency vocabulary.
 */
export async function deriveOwnCandidateCompetencyCodes(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<string[]> {
  const [skills, experiences, projects, candidateFacts] = await Promise.all([
    listOwnSkills(supabase, userId),
    listOwnExperiences(supabase, userId),
    listOwnProjects(supabase, userId),
    listOwnCandidateFacts(supabase, userId),
  ]);
  // education is fetched too, per docs/JOB_DISCOVERY.md's instruction to inspect all trusted
  // candidate-profile sources, but its school/degree/GPA text carries no competency vocabulary —
  // intentionally not concatenated into the matched text below.
  await listOwnEducation(supabase, userId);

  const trustedTextParts: string[] = [];

  for (const skill of skills) {
    if (skill.userApproved && skill.approvedForApplications) trustedTextParts.push(skill.name);
  }
  for (const experience of experiences) {
    if (experience.userApproved && experience.approvedForApplications && experience.description) {
      trustedTextParts.push(experience.description);
    }
  }
  for (const project of projects) {
    if (project.userApproved && project.approvedForApplications && project.description) {
      trustedTextParts.push(project.description);
    }
  }
  for (const fact of candidateFacts) {
    if (fact.userApproved && fact.approvedForApplications) trustedTextParts.push(fact.normalizedValue);
  }

  const combinedText = trustedTextParts.join('. ');
  return matchCompetencyConcepts(combinedText);
}
