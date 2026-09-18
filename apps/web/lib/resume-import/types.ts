import type {
  ResumeExtractionEducation,
  ResumeExtractionExperience,
  ResumeExtractionProject,
  ResumeExtractionSkill,
} from '@career-os/shared';

/** The personal fields both Resume Import entry points (/settings/resume-import and the
 * /profile inline panel) can review/autofill — mirrors profileUpdateSchema's flat top-level
 * fields, never headline/workAuthorization/relocationPreference (resumeExtractionPersonalSchema
 * has no source for those, so there is nothing to autofill there — left for manual entry). */
export interface CurrentProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  portfolio: string | null;
  github: string | null;
  website: string | null;
}

export const PERSONAL_FIELD_KEYS: (keyof CurrentProfile)[] = [
  'fullName',
  'email',
  'phone',
  'location',
  'linkedin',
  'portfolio',
  'github',
  'website',
];

export const PERSONAL_FIELD_LABELS: Record<keyof CurrentProfile, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  linkedin: 'LinkedIn',
  portfolio: 'Portfolio',
  github: 'GitHub',
  website: 'Website',
};

/** A personal field's review state — carries both the extracted value and, when it conflicts
 * with the existing profile value, the user's explicit choice (never auto-resolved). */
export interface PersonalFieldState {
  resumeValue: string | null;
  existingValue: string | null;
  choice: 'use_resume' | 'keep_existing' | 'exclude';
  editedValue: string;
}

export interface ReviewEntry<T> {
  /** The current (possibly user-edited) values — what gets used if this entry stays included. */
  item: T;
  included: boolean;
  editing: boolean;
  /** True when this entry exactly matches an item already in the user's saved profile (or,
   * on the /profile page, another entry already staged this same session) — defaults to
   * excluded so confirming never creates an obvious duplicate row, but stays visible and
   * still toggleable (never fuzzy-matched, never silently hidden). */
  isDuplicate: boolean;
}

export interface ExtractionState {
  personal: Record<keyof CurrentProfile, PersonalFieldState>;
  experience: ReviewEntry<ResumeExtractionExperience>[];
  education: ReviewEntry<ResumeExtractionEducation>[];
  projects: ReviewEntry<ResumeExtractionProject>[];
  skills: ReviewEntry<ResumeExtractionSkill>[];
  droppedCount: number;
}
