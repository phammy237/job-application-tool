import type { FieldClassification } from '../schemas/detected-field';
import type {
  ConsistencyFieldSource,
  ConsistencyFinding,
} from '../schemas/consistency-finding';

/**
 * Deterministic consistency-firewall rule engine (docs/IMPLEMENTATION_PLAN.md Phase 5B.2A/B/C).
 * Pure, deterministic, no database access, no network access, no Claude, no embeddings, no hidden
 * external state — every function here is a plain function of its arguments. The server-side
 * caller (packages/database) is responsible for gathering trusted, already-persisted/approved
 * data into the shapes below; this module only ever compares what it's given.
 *
 * Guiding principle throughout: a false positive WARNING is merely annoying, a false positive
 * BLOCKING finding is dangerous — every extractor below is written to return "uncertain" rather
 * than guess, and every rule skips silently (no finding) whenever its inputs are ambiguous.
 */

// ================================================================================================
// Normalization helpers
// ================================================================================================

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeForComparison(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

const COMPANY_SUFFIXES =
  /\b(inc\.?|llc\.?|l\.l\.c\.?|corp\.?|corporation|ltd\.?|llp\.?|co\.?|company|group|holdings)\b/gi;

/** Strips common legal-entity suffixes and punctuation so "Deloitte" and "Deloitte LLP" (the
 * product's own example of a non-mismatch) normalize to the same string. */
export function normalizeCompanyName(value: string): string {
  return collapseWhitespace(
    normalizeForComparison(value).replace(/[.,]/g, '').replace(COMPANY_SUFFIXES, ''),
  );
}

export function normalizeTitle(value: string): string {
  return normalizeForComparison(value).replace(/[.,]/g, '');
}

/** True when the two normalized strings are identical or one contains the other — deliberately
 * loose in the "equivalent" direction (never a false mismatch from a legal-suffix or abbreviation
 * difference), never loose in a way that would manufacture a false *match* between genuinely
 * different names (no fuzzy edit-distance, no token-overlap scoring). */
export function namesAreEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH_NAME_PATTERN = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|');

export interface MonthYear {
  year: number;
  month: number;
}

/**
 * Extracts a confident month+year from free text. Deliberately requires both a month and a year
 * token — a bare year ("2028") is ambiguous (graduation? start? something else entirely?) and is
 * never extracted. Recognizes "May 2028", "May, 2028", "05/2028", "5/2028", "2028-05", and
 * "2028-05-01" (day parsed but discarded — comparisons only ever happen at month granularity,
 * since a stored date's day is frequently a placeholder, not a fact free text is expected to
 * reproduce). Returns null — not a guess — for anything else.
 */
export function extractMonthYear(text: string): MonthYear | null {
  const normalized = normalizeForComparison(text);

  const isoMatch = normalized.match(/\b(\d{4})-(\d{1,2})(?:-\d{1,2})?\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }

  const slashMatch = normalized.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }

  const nameMatch = normalized.match(
    new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?,?\\s+(\\d{4})\\b`),
  );
  const monthToken = nameMatch?.[1];
  const yearToken = nameMatch?.[2];
  if (monthToken && yearToken) {
    const month = MONTH_NAMES[monthToken];
    const year = Number(yearToken);
    if (month) return { year, month };
  }

  return null;
}

/** The stored side is a real `date` column (ISO `YYYY-MM-DD`) — this never "extracts", it just
 * reads the two known-good fields directly. */
export function monthYearFromIsoDate(isoDate: string): MonthYear | null {
  const match = isoDate.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function monthYearEqual(a: MonthYear, b: MonthYear): boolean {
  return a.year === b.year && a.month === b.month;
}

export function formatMonthYear(value: MonthYear): string {
  return `${value.year}-${String(value.month).padStart(2, '0')}`;
}

/**
 * Requires an explicit decimal point — a bare integer ("4") is too ambiguous to confidently be a
 * GPA (years of experience, a 1-5 rating, etc. are all equally plausible readings). Returns a
 * value rounded to 2 decimal places so "3.9" and "3.90" compare equal.
 */
export function extractGpa(text: string): number | null {
  const match = text.match(/\b([0-4]\.\d{1,2})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (Number.isNaN(value) || value < 0 || value > 4) return null;
  return Math.round(value * 100) / 100;
}

export type YesNoPolarity = 'YES' | 'NO' | 'UNKNOWN';

const YES_TOKENS = new Set(['yes', 'y', 'true']);
const NO_TOKENS = new Set(['no', 'n', 'false']);

/**
 * Deliberately narrow: recognizes only a bare "yes"/"no" (the overwhelmingly common shape for an
 * autofilled or directly-answered Yes/No control) or a sentence's *first* word being yes/no
 * ("Yes, I am authorized..."). Never attempts to resolve polarity from words like "not",
 * "require", or "sponsorship" appearing later in a sentence — double-negative-prone phrasing
 * ("I do not require sponsorship" = YES; "I will not be able to start" = NO) is exactly where a
 * keyword heuristic becomes a false-positive risk, and a false positive here would be a
 * BLOCKING-severity mistake. Everything else returns UNKNOWN, which never produces a finding.
 */
export function extractYesNoPolarity(text: string): YesNoPolarity {
  const normalized = normalizeForComparison(text).replace(/[.,!]+$/, '');
  if (YES_TOKENS.has(normalized)) return 'YES';
  if (NO_TOKENS.has(normalized)) return 'NO';

  const firstWord = normalized.split(/[\s,]+/)[0];
  if (firstWord && YES_TOKENS.has(firstWord)) return 'YES';
  if (firstWord && NO_TOKENS.has(firstWord)) return 'NO';

  return 'UNKNOWN';
}

// ================================================================================================
// Deterministic finding id
// ================================================================================================

/**
 * Stable across re-evaluations of unchanged inputs — never `randomUUID()`. A plain (non-
 * cryptographic — this only needs to be stable/collision-resistant across a handful of findings
 * per application, not tamper-proof) FNV-1a hash over the rule id plus the normalized identity of
 * what's being compared, so an acknowledgement collected at an earlier GET /consistency-check
 * still matches the identical finding recomputed moments later at the authoritative PATCH
 * /mark-applied, as long as the underlying data hasn't changed.
 */
export function computeFindingId(parts: string[]): string {
  const input = parts.join(' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ================================================================================================
// Rule input shapes — gathered server-side from already-approved/persisted data only
// ================================================================================================

export interface ConsistencyCandidateAnswer {
  generatedAnswerId: string;
  fieldLabel: string;
  fieldClassification: FieldClassification;
  /** The effective submitted text: finalText if the user edited it, else the original AI answer.
   * Never the content of a row the user skipped/declined. */
  text: string;
}

export interface ConsistencyEducationFact {
  school: string;
  graduationDate: string | null;
  gpa: string | null;
}

export interface ConsistencyExperienceFact {
  company: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
}

export interface ConsistencyProfileFacts {
  workAuthorization: string | null;
  relocationPreference: string | null;
}

export interface ConsistencyRuleInput {
  answers: ConsistencyCandidateAnswer[];
  /** Already filtered to `userApproved && approvedForApplications` by the caller. */
  education: ConsistencyEducationFact[];
  /** Already filtered to `userApproved && approvedForApplications` by the caller. */
  experiences: ConsistencyExperienceFact[];
  profile: ConsistencyProfileFacts;
}

function makeFinding(params: {
  ruleId: ConsistencyFinding['ruleId'];
  severity: ConsistencyFinding['severity'];
  fieldALabel: string;
  fieldASource: ConsistencyFieldSource;
  fieldAValue: string;
  fieldBLabel: string;
  fieldBSource: ConsistencyFieldSource;
  fieldBValue: string;
  description: string;
  idParts: string[];
}): ConsistencyFinding {
  return {
    id: computeFindingId([params.ruleId, ...params.idParts]),
    ruleId: params.ruleId,
    severity: params.severity,
    fieldALabel: params.fieldALabel,
    fieldASource: params.fieldASource,
    fieldAValue: params.fieldAValue,
    fieldBLabel: params.fieldBLabel,
    fieldBSource: params.fieldBSource,
    fieldBValue: params.fieldBValue,
    description: params.description,
  };
}

// ================================================================================================
// GRADUATION_DATE_MISMATCH / GPA_MISMATCH (WARNING) — only when exactly one approved education
// record exists, so there is never a question of *which* record an unlabeled answer is about.
// ================================================================================================

function evaluateEducationRules(input: ConsistencyRuleInput): ConsistencyFinding[] {
  const record = input.education[0];
  if (input.education.length !== 1 || !record) return [];
  const findings: ConsistencyFinding[] = [];

  for (const answer of input.answers) {
    if (answer.fieldClassification !== 'EDUCATION') continue;
    const label = normalizeForComparison(answer.fieldLabel);

    if (label.includes('graduat') && record.graduationDate) {
      const stored = monthYearFromIsoDate(record.graduationDate);
      const extracted = extractMonthYear(answer.text);
      if (stored && extracted && !monthYearEqual(stored, extracted)) {
        findings.push(
          makeFinding({
            ruleId: 'GRADUATION_DATE_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: `${record.school} graduation date`,
            fieldBSource: 'PROFILE_EDUCATION',
            fieldBValue: formatMonthYear(stored),
            description: `The application answer "${answer.text}" states a graduation date that differs from your approved profile record (${formatMonthYear(stored)}) for ${record.school}.`,
            idParts: [answer.generatedAnswerId, record.school, record.graduationDate],
          }),
        );
      }
    }

    if (label.includes('gpa') && record.gpa) {
      const storedGpa = extractGpa(record.gpa);
      const extractedGpa = extractGpa(answer.text);
      if (storedGpa !== null && extractedGpa !== null && storedGpa !== extractedGpa) {
        findings.push(
          makeFinding({
            ruleId: 'GPA_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: `${record.school} GPA`,
            fieldBSource: 'PROFILE_EDUCATION',
            fieldBValue: storedGpa.toFixed(2),
            description: `The application answer "${answer.text}" states a GPA that differs from your approved profile record (${storedGpa.toFixed(2)}) for ${record.school}.`,
            idParts: [answer.generatedAnswerId, record.school, record.gpa],
          }),
        );
      }
    }
  }

  return findings;
}

// ================================================================================================
// EMPLOYMENT_DATE_MISMATCH / JOB_TITLE_COMPANY_MISMATCH (WARNING) — only when exactly one
// approved experience record exists, for the same "never fuzzy-select between multiple plausible
// employers" reason as the education rules above.
// ================================================================================================

function evaluateExperienceRules(input: ConsistencyRuleInput): ConsistencyFinding[] {
  const record = input.experiences[0];
  if (input.experiences.length !== 1 || !record) return [];
  const findings: ConsistencyFinding[] = [];

  for (const answer of input.answers) {
    if (answer.fieldClassification !== 'EXPERIENCE') continue;
    const label = normalizeForComparison(answer.fieldLabel);

    if ((label.includes('compan') || label.includes('employer')) && record.company) {
      const stored = normalizeCompanyName(record.company);
      const stated = normalizeCompanyName(answer.text);
      if (stated && !namesAreEquivalent(stored, stated)) {
        findings.push(
          makeFinding({
            ruleId: 'JOB_TITLE_COMPANY_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: 'Approved experience — company',
            fieldBSource: 'PROFILE_EXPERIENCE',
            fieldBValue: record.company,
            description: `The application answer "${answer.text}" names a different employer than your approved experience record ("${record.company}").`,
            idParts: [answer.generatedAnswerId, 'company', record.company],
          }),
        );
      }
    }

    // Deliberately excludes a looser keyword like "role" — "Describe your role" is a narrative
    // free-response prompt, not a structured title field, and would risk comparing prose against
    // a bare title string. Only "title"/"position" are specific enough to trust.
    if ((label.includes('title') || label.includes('position')) && record.title) {
      const stored = normalizeTitle(record.title);
      const stated = normalizeTitle(answer.text);
      if (stated && !namesAreEquivalent(stored, stated)) {
        findings.push(
          makeFinding({
            ruleId: 'JOB_TITLE_COMPANY_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: 'Approved experience — title',
            fieldBSource: 'PROFILE_EXPERIENCE',
            fieldBValue: record.title,
            description: `The application answer "${answer.text}" states a different title than your approved experience record ("${record.title}").`,
            idParts: [answer.generatedAnswerId, 'title', record.title],
          }),
        );
      }
    }

    if (label.includes('start') && record.startDate) {
      const stored = monthYearFromIsoDate(record.startDate);
      const extracted = extractMonthYear(answer.text);
      if (stored && extracted && !monthYearEqual(stored, extracted)) {
        findings.push(
          makeFinding({
            ruleId: 'EMPLOYMENT_DATE_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: 'Approved experience — start date',
            fieldBSource: 'PROFILE_EXPERIENCE',
            fieldBValue: formatMonthYear(stored),
            description: `The application answer "${answer.text}" states a start date that differs from your approved experience record (${formatMonthYear(stored)}).`,
            idParts: [answer.generatedAnswerId, 'start', record.startDate],
          }),
        );
      }
    }

    if (label.includes('end') && record.endDate) {
      const stored = monthYearFromIsoDate(record.endDate);
      const extracted = extractMonthYear(answer.text);
      if (stored && extracted && !monthYearEqual(stored, extracted)) {
        findings.push(
          makeFinding({
            ruleId: 'EMPLOYMENT_DATE_MISMATCH',
            severity: 'WARNING',
            fieldALabel: answer.fieldLabel,
            fieldASource: 'GENERATED_ANSWER',
            fieldAValue: answer.text,
            fieldBLabel: 'Approved experience — end date',
            fieldBSource: 'PROFILE_EXPERIENCE',
            fieldBValue: formatMonthYear(stored),
            description: `The application answer "${answer.text}" states an end date that differs from your approved experience record (${formatMonthYear(stored)}).`,
            idParts: [answer.generatedAnswerId, 'end', record.endDate],
          }),
        );
      }
    }
  }

  return findings;
}

// ================================================================================================
// ELIGIBILITY_SELF_CONTRADICTION / ELIGIBILITY_PROFILE_MISMATCH (WORK_AUTHORIZATION) and
// RELOCATION_SELF_CONTRADICTION / RELOCATION_PROFILE_MISMATCH (RELOCATION) — BLOCKING/WARNING
// respectively for each pair.
//
// Phase 5B hardening: these were originally one shared pair of rule ids reused for both
// classifications (an adversarial-review finding — a finding's ruleId alone couldn't tell a
// work-authorization concern apart from a relocation one). RELOCATION now gets its own dedicated
// ids, passed in by the caller below; WORK_AUTHORIZATION keeps the original ids unchanged, so
// every historical submission_packets.consistency_findings entry still parses exactly as before
// (packages/shared/src/schemas/consistency-finding.ts's own doc comment has the full rationale).
//
// "Question identity" is deliberately never inferred from label text/token-overlap (no fuzzy
// semantic guess) — two answers are only ever compared for self-contradiction when they share the
// exact same, already-trustworthy `fieldClassification` (WORK_AUTHORIZATION or RELOCATION), which
// Career OS already assigns deterministically at detection time. This is a structural proxy for
// "these are the same kind of eligibility question," not a guess.
// ================================================================================================

function evaluateEligibilityGroup(
  input: ConsistencyRuleInput,
  classification: Extract<FieldClassification, 'WORK_AUTHORIZATION' | 'RELOCATION'>,
  ruleId: 'ELIGIBILITY_SELF_CONTRADICTION' | 'RELOCATION_SELF_CONTRADICTION',
  profileMismatchRuleId: 'ELIGIBILITY_PROFILE_MISMATCH' | 'RELOCATION_PROFILE_MISMATCH',
  profileValue: string | null,
  profileLabel: string,
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const candidates = input.answers
    .filter((a) => a.fieldClassification === classification)
    .map((a) => ({ answer: a, polarity: extractYesNoPolarity(a.text) }))
    .filter((c) => c.polarity !== 'UNKNOWN');

  const yes = candidates.find((c) => c.polarity === 'YES');
  const no = candidates.find((c) => c.polarity === 'NO');

  if (yes && no) {
    findings.push(
      makeFinding({
        ruleId,
        severity: 'BLOCKING',
        fieldALabel: yes.answer.fieldLabel,
        fieldASource: 'GENERATED_ANSWER',
        fieldAValue: yes.answer.text,
        fieldBLabel: no.answer.fieldLabel,
        fieldBSource: 'GENERATED_ANSWER',
        fieldBValue: no.answer.text,
        description: `This application answers two ${classification === 'WORK_AUTHORIZATION' ? 'work-authorization' : 'relocation'} questions with opposite answers: "${yes.answer.fieldLabel}" = "${yes.answer.text}" but "${no.answer.fieldLabel}" = "${no.answer.text}". These cannot both be true.`,
        idParts: [yes.answer.generatedAnswerId, no.answer.generatedAnswerId],
      }),
    );
    // A self-contradiction inside the one application is the higher-priority signal — skip the
    // profile-mismatch check for this classification rather than also reporting which side (if
    // either) differs from the profile, which would be noise once the BLOCKING finding exists.
    return findings;
  }

  if (!profileValue) return findings;
  const profilePolarity = extractYesNoPolarity(profileValue);
  if (profilePolarity === 'UNKNOWN') return findings;

  for (const candidate of candidates) {
    if (candidate.polarity !== profilePolarity) {
      findings.push(
        makeFinding({
          ruleId: profileMismatchRuleId,
          severity: 'WARNING',
          fieldALabel: candidate.answer.fieldLabel,
          fieldASource: 'GENERATED_ANSWER',
          fieldAValue: candidate.answer.text,
          fieldBLabel: profileLabel,
          fieldBSource: 'PROFILE_ELIGIBILITY',
          fieldBValue: profileValue,
          description: `The application answer "${candidate.answer.text}" to "${candidate.answer.fieldLabel}" differs from your stored profile (${profileLabel}: "${profileValue}").`,
          idParts: [candidate.answer.generatedAnswerId, profileValue],
        }),
      );
    }
  }

  return findings;
}

// ================================================================================================
// Top-level evaluator
// ================================================================================================

export function evaluateConsistencyFindings(
  input: ConsistencyRuleInput,
): ConsistencyFinding[] {
  return [
    ...evaluateEducationRules(input),
    ...evaluateExperienceRules(input),
    ...evaluateEligibilityGroup(
      input,
      'WORK_AUTHORIZATION',
      'ELIGIBILITY_SELF_CONTRADICTION',
      'ELIGIBILITY_PROFILE_MISMATCH',
      input.profile.workAuthorization,
      'Profile work authorization',
    ),
    ...evaluateEligibilityGroup(
      input,
      'RELOCATION',
      'RELOCATION_SELF_CONTRADICTION',
      'RELOCATION_PROFILE_MISMATCH',
      input.profile.relocationPreference,
      'Profile relocation preference',
    ),
  ];
}
