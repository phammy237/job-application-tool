import type { CurrentProfile, ExtractionState, PersonalFieldState } from './types';

export interface ReviewedExperience {
  company: string;
  title: string;
  location: string | null;
  dateRangeText: string | null;
  startDate: null;
  endDate: null;
  description: string | null;
}

export interface ReviewedEducation {
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: null;
  graduationDate: null;
  gpa: string | null;
}

export interface ReviewedProject {
  name: string;
  role: string | null;
  url: string | null;
  startDate: null;
  endDate: null;
  description: string | null;
}

export interface ReviewedSkill {
  name: string;
  category: string | null;
}

export interface ReviewedResumeImportPayload {
  personal: Partial<Record<keyof CurrentProfile, string | null>>;
  experience: ReviewedExperience[];
  education: ReviewedEducation[];
  projects: ReviewedProject[];
  skills: ReviewedSkill[];
}

/**
 * Flattens reviewed extraction state (Include/Edit/Exclude decisions + edited text already
 * applied) into the plain payload shape both Resume Import entry points need: the
 * /settings/resume-import page POSTs this straight to the confirm API, and the /profile inline
 * panel maps it directly onto in-memory form/staged-item state. Never invents a structured
 * start/end date from `dateRangeText` (deliberately always `null` — the AI-suggested date range
 * is shown for review context only; wiring `parseResumeDateText` into either date field is a
 * separate, not-yet-requested change, kept out of scope here to match this pair's existing,
 * already-shipped confirm behavior).
 */
export function buildReviewedResumeImportPayload(extraction: ExtractionState): ReviewedResumeImportPayload {
  const personal: ReviewedResumeImportPayload['personal'] = {};
  for (const [key, field] of Object.entries(extraction.personal) as [
    keyof CurrentProfile,
    PersonalFieldState,
  ][]) {
    if (field.choice === 'exclude') continue;
    if (field.choice === 'keep_existing') continue; // omit — caller keeps the existing value
    personal[key] = field.editedValue.trim() || null;
  }

  return {
    personal,
    experience: extraction.experience
      .filter((e) => e.included)
      .map((e) => ({
        company: e.item.company,
        title: e.item.title,
        location: e.item.location,
        dateRangeText: e.item.dateRangeText,
        startDate: null,
        endDate: null,
        description: e.item.bullets.join('\n') || null,
      })),
    education: extraction.education
      .filter((e) => e.included)
      .map((e) => ({
        school: e.item.school,
        degree: e.item.degree,
        fieldOfStudy: e.item.fieldOfStudy,
        startDate: null,
        graduationDate: null,
        gpa: e.item.gpa,
      })),
    projects: extraction.projects
      .filter((p) => p.included)
      .map((p) => ({
        name: p.item.name,
        role: p.item.role,
        url: p.item.url,
        startDate: null,
        endDate: null,
        description: p.item.bullets.join('\n') || null,
      })),
    skills: extraction.skills
      .filter((s) => s.included)
      .map((s) => ({ name: s.item.name, category: s.item.category })),
  };
}
