import type { NormalizedEmploymentType } from '../schemas/job-role-taxonomy';

/**
 * Normalizes `job_catalog.employment_type`'s free-text raw provider values into the D4 taxonomy
 * (docs/JOB_DISCOVERY.md "Employment type normalization"). Live data proved this field has at
 * least 8 distinct spellings for ~5 real categories across and even *within* a single provider
 * (Lever alone: "Full Time", "Full-time") — this strips whitespace/punctuation/case before
 * matching so all of them collapse correctly.
 *
 * `null` (100% of Greenhouse rows — a structural gap, not a job characteristic) always maps to
 * UNKNOWN, never FULL_TIME or any other guess — Greenhouse jobs must never be penalized for a
 * missing field the provider's API simply doesn't expose.
 */
export function normalizeEmploymentType(raw: string | null): NormalizedEmploymentType {
  if (!raw) return 'UNKNOWN';

  const key = raw.toLowerCase().replace(/[^a-z]/g, '');

  switch (key) {
    case 'fulltime':
      return 'FULL_TIME';
    case 'parttime':
      return 'PART_TIME';
    case 'contract':
    case 'contractor':
      return 'CONTRACT';
    case 'internship':
    case 'intern':
      return 'INTERNSHIP';
    case 'temporary':
    case 'fixedterm':
    case 'temp':
      return 'TEMPORARY';
    default:
      return 'UNKNOWN';
  }
}
