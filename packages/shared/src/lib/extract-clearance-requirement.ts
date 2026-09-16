import { containsPhrase } from './phrase-matcher';

export type ClearanceRequirement =
  | 'ACTIVE_CLEARANCE_REQUIRED'
  | 'CLEARANCE_ELIGIBILITY_REQUIRED'
  | 'UNKNOWN';

export interface ClearanceExtraction {
  requirement: ClearanceRequirement;
  evidence: string | null;
}

const EVIDENCE_MAX_LENGTH = 300;

/**
 * Explicit, deterministic security-clearance-requirement extraction (docs/JOB_DISCOVERY.md
 * "Eligibility check types"). Deliberately distinguishes two different requirements that are NOT
 * interchangeable (DoD's own definition-of-done point): a posting that requires an ALREADY-HELD
 * active clearance is a stricter bar than one that only requires the candidate be ELIGIBLE to
 * obtain one.
 *
 * A sentence that mentions an active-clearance phrase is normally `ACTIVE_CLEARANCE_REQUIRED` —
 * UNLESS the same sentence also carries an explicit "or [the] ability/eligibility to obtain"
 * qualifier, a real phrasing confirmed live against the catalog (Palantir: "Active clearance or
 * an ability to obtain an active clearance in the country the job is advertised"). That specific
 * wording is offering the more permissive bar as an explicit alternative, so it's classified
 * `CLEARANCE_ELIGIBILITY_REQUIRED`, not the stricter category — an already-active-clearance-only
 * classification would misrepresent what the posting actually said.
 */
const ACTIVE_REQUIRED_PHRASES = [
  'active security clearance',
  'active top secret clearance',
  'active secret clearance',
  'active clearance',
  'must possess an active clearance',
  'must possess a current clearance',
  'must currently hold an active clearance',
  'current active clearance required',
];

const ELIGIBILITY_QUALIFIER_PHRASES = [
  'ability to obtain',
  'eligibility to obtain',
  'able to obtain',
  'eligible to obtain',
];

const ELIGIBILITY_REQUIRED_PHRASES = [
  'eligible to obtain a security clearance',
  'able to obtain a security clearance',
  'ability to obtain a security clearance',
  'must be eligible to obtain a clearance',
  'eligibility to obtain a clearance',
  'eligible to obtain and maintain a security clearance',
  ...ELIGIBILITY_QUALIFIER_PHRASES,
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function boundedEvidence(sentence: string): string {
  const trimmed = sentence.trim();
  return trimmed.length > EVIDENCE_MAX_LENGTH ? `${trimmed.slice(0, EVIDENCE_MAX_LENGTH)}…` : trimmed;
}

export function extractClearanceRequirement(plainText: string): ClearanceExtraction {
  const sentences = splitSentences(plainText);

  for (const sentence of sentences) {
    const mentionsActive = ACTIVE_REQUIRED_PHRASES.some((phrase) => containsPhrase(sentence, phrase));
    if (!mentionsActive) continue;

    const alsoOffersEligibilityAlternative = ELIGIBILITY_QUALIFIER_PHRASES.some((phrase) =>
      containsPhrase(sentence, phrase),
    );
    if (alsoOffersEligibilityAlternative) {
      return { requirement: 'CLEARANCE_ELIGIBILITY_REQUIRED', evidence: boundedEvidence(sentence) };
    }
    return { requirement: 'ACTIVE_CLEARANCE_REQUIRED', evidence: boundedEvidence(sentence) };
  }

  for (const sentence of sentences) {
    if (ELIGIBILITY_REQUIRED_PHRASES.some((phrase) => containsPhrase(sentence, phrase))) {
      return { requirement: 'CLEARANCE_ELIGIBILITY_REQUIRED', evidence: boundedEvidence(sentence) };
    }
  }
  return { requirement: 'UNKNOWN', evidence: null };
}
