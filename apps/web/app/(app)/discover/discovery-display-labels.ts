/**
 * Shared human-readable labels for D4's closed, system-owned enums — used by both `/discover`
 * (filters, job cards) and `/settings/discovery` (D5B's preference editors), so the two surfaces
 * can never drift into showing different names for the same underlying value. Purely cosmetic:
 * the value actually read/written anywhere is always the raw enum member, never one of these
 * labels.
 */

export const CRITERION_LABELS: Record<string, string> = {
  ROLE_FIT: 'Role fit',
  COMPETENCY_FIT: 'Skills & competencies',
  SENIORITY_FIT: 'Seniority fit',
  LOCATION_FIT: 'Location fit',
  WORK_MODE_FIT: 'Work mode fit',
  EMPLOYMENT_TYPE_FIT: 'Employment type fit',
  OBSERVED_FRESHNESS: 'Posting freshness',
};

export const ROLE_FAMILY_LABELS: Record<string, string> = {
  PRODUCT_MANAGEMENT: 'Product Management',
  TECHNICAL_PROGRAM_MANAGEMENT: 'Technical Program Management',
  PRODUCT_ANALYTICS: 'Product Analytics',
  DATA_ANALYTICS: 'Data Analytics',
  DATA_SCIENCE: 'Data Science',
  SOFTWARE_ENGINEERING: 'Software Engineering',
  BUSINESS_ANALYTICS: 'Business Analytics',
  STRATEGY_OPERATIONS: 'Strategy & Operations',
  CONSULTING: 'Consulting',
};

export const SENIORITY_LABELS: Record<string, string> = {
  INTERN: 'Intern',
  NEW_GRAD: 'New grad',
  ENTRY: 'Entry-level',
  MID: 'Mid-level',
  SENIOR: 'Senior',
  STAFF: 'Staff',
  PRINCIPAL: 'Principal',
  MANAGER: 'Manager',
  DIRECTOR_PLUS: 'Director and above',
};

export const WORKPLACE_LABELS: Record<string, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
};

export const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
};

export const LOCATION_PREFERENCE_CATEGORY_LABELS: Record<string, string> = {
  PREFERRED: 'Preferred',
  ACCEPTABLE: 'Acceptable',
  AVOID: 'Avoid',
  EXCLUDE: 'Exclude entirely',
};

/** `NEW_YORK_NY` -> `New York NY`, `UNITED_STATES` -> `United States` — purely cosmetic; the
 * value actually submitted is always the raw token from `list_discovery_location_tokens`, never
 * this label. */
export function formatLocationTokenLabel(token: string): string {
  return token
    .split('_')
    .map((part) => (part.length <= 2 ? part : part[0] + part.slice(1).toLowerCase()))
    .join(' ');
}
