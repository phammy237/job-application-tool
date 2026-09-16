import { containsPhrase } from './phrase-matcher';

export type CitizenshipRequirement = 'US_CITIZEN_ONLY' | 'UNKNOWN';

export interface CitizenshipExtraction {
  requirement: CitizenshipRequirement;
  evidence: string | null;
}

const EVIDENCE_MAX_LENGTH = 300;

/**
 * Explicit, deterministic US-citizenship-requirement extraction (docs/JOB_DISCOVERY.md
 * "Eligibility check types"). V1 covers only the single, dominant explicit pattern actually
 * observed in US-market ATS postings — "US citizens only" style language — not a general
 * nationality-requirement parser; anything else (a different country's citizenship requirement,
 * ambiguous residency language) stays UNKNOWN rather than guessed. Most postings never mention
 * citizenship at all, which is the expected common case.
 */
const US_CITIZEN_ONLY_PHRASES = [
  'us citizens only',
  'u.s. citizens only',
  'united states citizens only',
  'must be a us citizen',
  'must be a u.s. citizen',
  'must be a united states citizen',
  'must be a citizen of the united states',
  'us citizenship required',
  'u.s. citizenship required',
  'united states citizenship is required',
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function boundedEvidence(sentence: string): string {
  const trimmed = sentence.trim();
  return trimmed.length > EVIDENCE_MAX_LENGTH ? `${trimmed.slice(0, EVIDENCE_MAX_LENGTH)}…` : trimmed;
}

export function extractCitizenshipRequirement(plainText: string): CitizenshipExtraction {
  for (const sentence of splitSentences(plainText)) {
    if (US_CITIZEN_ONLY_PHRASES.some((phrase) => containsPhrase(sentence, phrase))) {
      return { requirement: 'US_CITIZEN_ONLY', evidence: boundedEvidence(sentence) };
    }
  }
  return { requirement: 'UNKNOWN', evidence: null };
}
