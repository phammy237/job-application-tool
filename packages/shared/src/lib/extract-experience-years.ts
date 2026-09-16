/**
 * Conservative, deterministic "years of experience" extraction (docs/JOB_DISCOVERY.md
 * "Experience requirement extraction"). Only ever looks inside a sentence that mentions BOTH a
 * number-of-years pattern AND the word "experience" — this is the guard against confusing a
 * graduation year, company age, product age, a plain date, or a revenue figure with an
 * experience requirement (all of those can contain "N years" without ever meaning "you need N
 * years of experience").
 *
 * Returns `{ min, max }` (either may be null — "3+ years" has no max; "minimum of 5 years" has
 * no max) or null when nothing qualifies. This is feature data only — CLAUDE.md/docs/
 * JOB_DISCOVERY.md are explicit that a stated years-of-experience requirement must NEVER become
 * an automatic Eligibility conflict; it only ever feeds SENIORITY_FIT/COMPETENCY_FIT scoring.
 */
export interface ExperienceYearsRange {
  min: number | null;
  max: number | null;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

const RANGE_PATTERN = /(\d+)\s*(?:-|–|—|to)\s*(\d+)\+?\s*years?/i;
const PLUS_PATTERN = /(\d+)\s*\+\s*years?/i;
const AT_LEAST_PATTERN = /at least\s+(\d+)\s*years?/i;
const MINIMUM_PATTERN = /minimum(?:\s+of)?\s+(\d+)\s*years?/i;
const BARE_YEARS_OF_EXPERIENCE_PATTERN = /(\d+)\s*years?\s+of\s+experience/i;

function extractFromSentence(sentence: string): ExperienceYearsRange | null {
  const rangeMatch = sentence.match(RANGE_PATTERN);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  }

  const plusMatch = sentence.match(PLUS_PATTERN);
  if (plusMatch?.[1]) return { min: Number(plusMatch[1]), max: null };

  const atLeastMatch = sentence.match(AT_LEAST_PATTERN);
  if (atLeastMatch?.[1]) return { min: Number(atLeastMatch[1]), max: null };

  const minimumMatch = sentence.match(MINIMUM_PATTERN);
  if (minimumMatch?.[1]) return { min: Number(minimumMatch[1]), max: null };

  const bareMatch = sentence.match(BARE_YEARS_OF_EXPERIENCE_PATTERN);
  if (bareMatch?.[1]) return { min: Number(bareMatch[1]), max: null };

  return null;
}

export function extractExperienceYears(plainText: string): ExperienceYearsRange | null {
  for (const sentence of splitSentences(plainText)) {
    if (!/experience/i.test(sentence) || !/years?/i.test(sentence)) continue;
    const result = extractFromSentence(sentence);
    if (result) return result;
  }
  return null;
}
