/**
 * Exact-match dedup predicates for Resume Import (never fuzzy — CLAUDE.md/docs' explicit "do NOT
 * fuzzy-merge" rule). Shared by every place a reviewed, resume-extracted candidate row is checked
 * against rows that already exist (or are already staged) so a repeat confirm/autofill never
 * creates a second identical row: the confirm API route (apps/web/app/api/profile/resume-import/
 * confirm/route.ts) and the /profile page's inline autofill panel both call these instead of each
 * defining their own comparison.
 */

interface ExperienceLike {
  company: string;
  title: string;
  description: string | null;
}

interface EducationLike {
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
}

interface ProjectLike {
  name: string;
  description: string | null;
}

interface SkillLike {
  name: string;
}

export function isDuplicateExperience(existing: ExperienceLike[], candidate: ExperienceLike): boolean {
  return existing.some(
    (e) =>
      e.company === candidate.company &&
      e.title === candidate.title &&
      e.description === candidate.description,
  );
}

export function isDuplicateEducation(existing: EducationLike[], candidate: EducationLike): boolean {
  return existing.some(
    (e) =>
      e.school === candidate.school &&
      e.degree === candidate.degree &&
      e.fieldOfStudy === candidate.fieldOfStudy,
  );
}

export function isDuplicateProject(existing: ProjectLike[], candidate: ProjectLike): boolean {
  return existing.some((p) => p.name === candidate.name && p.description === candidate.description);
}

export function isDuplicateSkill(existing: SkillLike[], candidate: SkillLike): boolean {
  return existing.some((s) => s.name.toLowerCase() === candidate.name.toLowerCase());
}
