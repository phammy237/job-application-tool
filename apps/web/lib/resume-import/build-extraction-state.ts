import type { ResumeExtractionResult } from '@career-os/shared';
import { isDuplicateEducation, isDuplicateExperience, isDuplicateProject, isDuplicateSkill } from '@career-os/shared';
import { PERSONAL_FIELD_KEYS, type CurrentProfile, type ExtractionState, type PersonalFieldState } from './types';

interface ExistingCollections {
  experience?: { company: string; title: string; description: string | null }[];
  education?: { school: string; degree: string | null; fieldOfStudy: string | null }[];
  projects?: { name: string; description: string | null }[];
  skills?: { name: string }[];
}

/**
 * Builds the client-side review state for a fresh analyze result — shared by both Resume Import
 * entry points (/settings/resume-import and the /profile inline panel) so conflict handling and
 * duplicate detection behave identically everywhere (CLAUDE.md: never duplicate review/conflict
 * logic). `existing` is optional — the /settings page has never plumbed the user's current
 * collections through, so it stays undefined there and every item is offered included, matching
 * that page's existing behavior unchanged.
 */
export function buildExtractionState(
  result: ResumeExtractionResult,
  currentProfile: CurrentProfile | null,
  existing?: ExistingCollections,
): ExtractionState {
  const personal = {} as ExtractionState['personal'];
  for (const key of PERSONAL_FIELD_KEYS) {
    const resumeValue = result.personal[key];
    const existingValue = currentProfile?.[key] ?? null;
    // Default choice: if there's nothing to conflict with, use the resume value when one was
    // found; if the existing value already differs, default to keeping it — never silently
    // overwrite a real existing fact (the user must explicitly choose "Use resume value").
    const choice: PersonalFieldState['choice'] =
      !resumeValue ? 'exclude' : !existingValue ? 'use_resume' : 'keep_existing';
    personal[key] = {
      resumeValue,
      existingValue,
      choice,
      editedValue: resumeValue ?? '',
    };
  }

  const bulletsToDescription = (bullets: string[]) => bullets.join('\n') || null;

  return {
    personal,
    experience: result.experience.map((item) => {
      const isDuplicate = existing?.experience
        ? isDuplicateExperience(existing.experience, {
            company: item.company,
            title: item.title,
            description: bulletsToDescription(item.bullets),
          })
        : false;
      return { item, included: !isDuplicate, editing: false, isDuplicate };
    }),
    education: result.education.map((item) => {
      const isDuplicate = existing?.education
        ? isDuplicateEducation(existing.education, item)
        : false;
      return { item, included: !isDuplicate, editing: false, isDuplicate };
    }),
    projects: result.projects.map((item) => {
      const isDuplicate = existing?.projects
        ? isDuplicateProject(existing.projects, {
            name: item.name,
            description: bulletsToDescription(item.bullets),
          })
        : false;
      return { item, included: !isDuplicate, editing: false, isDuplicate };
    }),
    skills: result.skills.map((item) => {
      const isDuplicate = existing?.skills ? isDuplicateSkill(existing.skills, item) : false;
      return { item, included: !isDuplicate, editing: false, isDuplicate };
    }),
    droppedCount: result.droppedCount,
  };
}
