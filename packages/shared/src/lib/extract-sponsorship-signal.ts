import { containsPhrase } from './phrase-matcher';

export type SponsorshipSignal = 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';

export interface SponsorshipExtraction {
  signal: SponsorshipSignal;
  evidence: string | null;
}

const EVIDENCE_MAX_LENGTH = 300;

/**
 * Explicit, deterministic phrase rules for what a posting itself says about sponsorship
 * (docs/JOB_DISCOVERY.md "Sponsorship / work authorization extraction"). This is a description
 * of the POSTING's own stated policy — never the user's situation, never inferred from company
 * identity/size/industry/history/location, never a web search. Silence -> UNKNOWN, always;
 * UNKNOWN here must never later become a Eligibility CONFLICT on its own (see
 * `eligibility-aggregation.ts` — that only happens when the user has told Career OS they need
 * sponsorship AND the posting explicitly says no).
 *
 * NOT_AVAILABLE phrases are checked first — a posting essentially never states both explicitly,
 * but if it somehow did, the restrictive statement is the more actionable/definitive one.
 */
const NOT_AVAILABLE_PHRASES = [
  'unable to sponsor',
  'not able to sponsor',
  'no sponsorship',
  'not sponsor',
  'does not sponsor',
  'do not sponsor',
  'will not sponsor',
  "won't sponsor",
  'cannot sponsor',
  "can't sponsor",
  'cannot provide visa sponsorship',
  'cannot provide sponsorship',
  'unable to provide visa sponsorship',
  'unable to provide sponsorship',
  'without sponsorship',
  'no visa sponsorship',
  'not require sponsorship',
  'without requiring sponsorship',
  'requires no sponsorship',
];

const AVAILABLE_PHRASES = [
  'sponsorship is available',
  'sponsorship available',
  'visa sponsorship available',
  'we sponsor',
  'will sponsor',
  'sponsor visas',
  'sponsor h-1b',
  'sponsor h1b',
  'opt candidates welcome',
  'cpt candidates welcome',
  'opt candidates are welcome',
  'cpt candidates are welcome',
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function boundedEvidence(sentence: string): string {
  const trimmed = sentence.trim();
  return trimmed.length > EVIDENCE_MAX_LENGTH ? `${trimmed.slice(0, EVIDENCE_MAX_LENGTH)}…` : trimmed;
}

export function extractSponsorshipSignal(plainText: string): SponsorshipExtraction {
  for (const sentence of splitSentences(plainText)) {
    if (NOT_AVAILABLE_PHRASES.some((phrase) => containsPhrase(sentence, phrase))) {
      return { signal: 'NOT_AVAILABLE', evidence: boundedEvidence(sentence) };
    }
  }
  for (const sentence of splitSentences(plainText)) {
    if (AVAILABLE_PHRASES.some((phrase) => containsPhrase(sentence, phrase))) {
      return { signal: 'AVAILABLE', evidence: boundedEvidence(sentence) };
    }
  }
  return { signal: 'UNKNOWN', evidence: null };
}
