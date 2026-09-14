import type { Education } from '../schemas/education';
import type { Experience } from '../schemas/experience';
import type { Profile } from '../schemas/profile';
import type { Project } from '../schemas/project';
import {
  createEmptyStructuredResume,
  createResumeEntryId,
  type ResumeBullet,
  type ResumeDate,
  type ResumeDateRange,
  type ResumeEducationEntry,
  type ResumeExperienceEntry,
  type ResumeHeader,
  type ResumeProjectEntry,
  type ResumeSkillGroup,
  type StructuredResumeV1,
} from '../schemas/resume-content';
import type { Skill } from '../schemas/skill';

/**
 * Builds a starting `StructuredResumeV1` from the user's own already-approved profile data — an
 * explicit, reviewable "import" the user triggers in the Studio, never anything auto-applied or
 * auto-saved (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §9: "make clear it is an import/build
 * operation requiring review"). Only rows with `userApproved && approvedForApplications` are
 * included — the same grounding bar every other AI/autofill path in this product already uses
 * (docs/AI_GROUNDING.md), applied here even though this path calls no model at all, for the same
 * reason: an unapproved fact should not end up in a document the user might hand to an employer.
 *
 * Never fabricates leadership content: `experiences`/`education`/`projects`/`skills` are
 * structured tables this can faithfully copy from, but there is no equivalent structured
 * "leadership" table (only flat `candidate_facts` rows with no organization/role/date shape) —
 * guessing that shape would be inventing structure the user never actually entered. Leadership
 * always starts empty from this import; the user adds it manually.
 */
export function buildStructuredResumeFromProfile(
  profile: Profile | null,
  experiences: Experience[],
  education: Education[],
  projects: Project[],
  skills: Skill[],
): StructuredResumeV1 {
  const header = buildHeaderFromProfile(profile);
  const base = createEmptyStructuredResume(header);

  return {
    ...base,
    education: education.filter(isApproved).map(mapEducationEntry),
    experience: experiences.filter(isApproved).map(mapExperienceEntry),
    projects: projects.filter(isApproved).map(mapProjectEntry),
    skills: buildSkillGroups(skills.filter(isApproved)),
  };
}

function isApproved(record: { userApproved: boolean; approvedForApplications: boolean }) {
  return record.userApproved && record.approvedForApplications;
}

/** `fullName` is required by `resumeHeaderSchema` (a résumé header always needs *some* name
 * label) — falls back to the profile's email, then a plainly-editable placeholder, rather than
 * ever leaving the studio with an invalid document. Never fabricates a real name. */
function buildHeaderFromProfile(profile: Profile | null): ResumeHeader {
  const fullName = profile?.fullName?.trim() || profile?.email?.trim() || 'Your Name';
  return {
    fullName,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    location: profile?.location ?? null,
    links: profile?.links ?? {},
  };
}

/** "YYYY-MM-DD" -> {year, month}. Returns null for null/malformed input rather than throwing —
 * profile data may predate stricter validation, and an import must never crash on it. */
function parseIsoDateToResumeDate(iso: string | null): ResumeDate | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function buildDateRange(startIso: string | null, endIso: string | null): ResumeDateRange {
  return {
    start: parseIsoDateToResumeDate(startIso),
    end: endIso ? parseIsoDateToResumeDate(endIso) : null,
    isPresent: !endIso && !!startIso,
  };
}

/** A `description` column is one free-text blob, not pre-split into résumé bullets — splitting
 * on the user's own line breaks (a common way multi-point descriptions are already written) is
 * the smallest faithful structuring, never inventing new sentences. A single-paragraph
 * description with no line breaks becomes exactly one bullet. */
function splitDescriptionIntoBullets(
  description: string | null,
  sourceFactId: string | null,
): ResumeBullet[] {
  if (!description || !description.trim()) return [];
  const provenance: ResumeBullet['provenance'] = sourceFactId
    ? { type: 'CANDIDATE_FACTS', sourceFactIds: [sourceFactId] }
    : { type: 'MANUAL' };
  return description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ id: createResumeEntryId(), text, provenance }));
}

function mapEducationEntry(edu: Education): ResumeEducationEntry {
  return {
    id: createResumeEntryId(),
    institution: edu.school,
    degree: edu.degree,
    fieldOfStudy: edu.fieldOfStudy,
    location: null,
    dateRange: buildDateRange(edu.startDate, edu.graduationDate),
    gpa: edu.gpa,
    honors: edu.honors,
    bullets: [],
  };
}

function mapExperienceEntry(exp: Experience): ResumeExperienceEntry {
  return {
    id: createResumeEntryId(),
    organization: exp.company,
    role: exp.title,
    location: exp.location,
    dateRange: buildDateRange(exp.startDate, exp.endDate),
    bullets: splitDescriptionIntoBullets(exp.description, exp.sourceFactId),
  };
}

function mapProjectEntry(project: Project): ResumeProjectEntry {
  return {
    id: createResumeEntryId(),
    name: project.name,
    role: project.role,
    url: project.url,
    dateRange: buildDateRange(project.startDate, project.endDate),
    bullets: splitDescriptionIntoBullets(project.description, project.sourceFactId),
  };
}

/** Groups by the existing `skills.category` column so a user whose skills are already
 * categorized ("Languages", "Frameworks", ...) keeps that grouping; uncategorized skills land in
 * one generic "Skills" group rather than being dropped. */
function buildSkillGroups(skills: Skill[]): ResumeSkillGroup[] {
  const groups = new Map<string, string[]>();
  for (const skill of skills) {
    const label = skill.category?.trim() || 'Skills';
    const items = groups.get(label) ?? [];
    items.push(skill.name);
    groups.set(label, items);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({
    id: createResumeEntryId(),
    label,
    items,
  }));
}
