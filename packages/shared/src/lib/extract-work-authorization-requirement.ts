import { containsPhrase } from './phrase-matcher';

export type WorkAuthorizationRequirement = 'AUTHORIZATION_REQUIRED' | 'UNKNOWN';

export interface WorkAuthorizationExtraction {
  requirement: WorkAuthorizationRequirement;
  evidence: string | null;
}

const EVIDENCE_MAX_LENGTH = 300;

/**
 * A narrower, distinct signal from `extract-sponsorship-signal.ts` (docs/JOB_DISCOVERY.md
 * "Eligibility check types" — SPONSORSHIP and WORK_AUTHORIZATION are separate check types). Many
 * postings state a plain "must be authorized to work in the United States" requirement without
 * ever mentioning sponsorship at all — this extractor looks specifically for that, and
 * deliberately excludes any sentence that also mentions "sponsor" (that sentence belongs to the
 * sponsorship extractor's territory; flagging the same sentence into two different eligibility
 * checks would double-count one underlying statement).
 */
const AUTHORIZATION_PHRASES = [
  'must be authorized to work',
  'authorized to work in the united states',
  'legally authorized to work',
  'must have authorization to work',
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function boundedEvidence(sentence: string): string {
  const trimmed = sentence.trim();
  return trimmed.length > EVIDENCE_MAX_LENGTH ? `${trimmed.slice(0, EVIDENCE_MAX_LENGTH)}…` : trimmed;
}

export function extractWorkAuthorizationRequirement(plainText: string): WorkAuthorizationExtraction {
  for (const sentence of splitSentences(plainText)) {
    // Substring (not word-boundary) on purpose: "sponsor" must also exclude "sponsorship" /
    // "sponsoring", and a false-positive exclusion here only ever falls back to the always-safe
    // UNKNOWN, never a wrong requirement.
    if (/sponsor/i.test(sentence)) continue;
    if (AUTHORIZATION_PHRASES.some((phrase) => containsPhrase(sentence, phrase))) {
      return { requirement: 'AUTHORIZATION_REQUIRED', evidence: boundedEvidence(sentence) };
    }
  }
  return { requirement: 'UNKNOWN', evidence: null };
}
