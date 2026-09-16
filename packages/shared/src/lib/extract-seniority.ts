import type { Seniority } from '../schemas/job-role-taxonomy';
import { containsPhrase, firstMatchingPhrase } from './phrase-matcher';

/**
 * Deterministic, title-only seniority classification (docs/JOB_DISCOVERY.md "Seniority
 * extraction"). Only the explicit signals the design spec names are used — there is no rule for
 * ENTRY or MID (both remain reachable in the taxonomy for future refinement, but V1 never
 * assigns them from title text alone): "Unknown beats a bad guess" is taken literally rather
 * than inventing extra trigger words not given by the design.
 *
 * A dedicated wrinkle: many common job titles legitimately contain the word "manager" as part of
 * a FUNCTIONAL title (Product Manager, Program Manager, Technical Program Manager, Account
 * Manager, Project Manager) without indicating a people-management seniority level at all. The
 * generic MANAGER rule below is checked only after ruling those out, so "Product Manager" is
 * UNKNOWN seniority (correct — it says nothing about level) rather than MANAGER.
 */
const FUNCTIONAL_MANAGER_TITLE_PHRASES = [
  'product manager',
  'program manager',
  'project manager',
  'account manager',
  'technical program manager',
  'deal manager',
  'talent manager',
  'vendor manager',
  'partner manager',
  'channel manager',
];

const DIRECTOR_PLUS_PHRASES = ['director', 'vp', 'vice president', 'head of', 'chief'];
const PRINCIPAL_PHRASES = ['principal'];
const STAFF_PHRASES = ['staff'];
const SENIOR_PHRASES = ['senior'];
// "Sr" as an abbreviation ends in an optional period followed by whitespace/end-of-string, which
// a plain `\b...\b` phrase match can't express (a trailing "." is itself a non-word character, so
// `\b` never lands right after it when followed by a space) — a dedicated lookahead-based regex
// instead of `phrase-matcher.ts`'s helper.
const SENIOR_ABBREVIATION = /\bsr\.?(?=\s|$)/i;
const INTERN_PHRASES = ['intern', 'internship'];
const NEW_GRAD_PHRASES = ['new grad', 'new graduate', 'university grad', 'early career'];

export function extractSeniority(title: string): Seniority {
  if (firstMatchingPhrase(title, DIRECTOR_PLUS_PHRASES)) return 'DIRECTOR_PLUS';

  const isFunctionalManagerTitle = FUNCTIONAL_MANAGER_TITLE_PHRASES.some((phrase) =>
    containsPhrase(title, phrase),
  );
  if (!isFunctionalManagerTitle && containsPhrase(title, 'manager')) return 'MANAGER';

  if (firstMatchingPhrase(title, PRINCIPAL_PHRASES)) return 'PRINCIPAL';
  if (firstMatchingPhrase(title, STAFF_PHRASES)) return 'STAFF';
  if (firstMatchingPhrase(title, SENIOR_PHRASES) || SENIOR_ABBREVIATION.test(title)) return 'SENIOR';

  // Internship beats "new grad" when both somehow appear (e.g. "New Grad Internship" is still
  // fundamentally an internship), and both are checked before any weaker signal.
  if (firstMatchingPhrase(title, INTERN_PHRASES)) return 'INTERN';
  if (firstMatchingPhrase(title, NEW_GRAD_PHRASES)) return 'NEW_GRAD';

  return 'UNKNOWN';
}
