import type { EmailClassification } from '@career-os/shared';

export interface ClassifyDeterministicInput {
  subject: string | null;
  snippet: string;
}

export interface DeterministicClassificationResult {
  classification: EmailClassification;
  confidence: number;
  evidence: string;
}

/**
 * Deterministic rules are either confident or silent — a fixed high confidence per match, never
 * a partial/uncertain score. `null` signals "send to Claude fallback"
 * (docs/EMAIL_INTEGRATION.md §1.4-5). Checked in this order because more specific/decisive
 * signals (an explicit rejection or offer) should win over a merely-plausible earlier-stage
 * phrase that might also appear in the same message (e.g. a rejection email that also mentions
 * "your application" in passing).
 */
const RULES: Array<{ classification: EmailClassification; phrases: string[] }> = [
  {
    classification: 'OFFER',
    phrases: ['pleased to offer', 'offer letter', 'formal offer', 'extend an offer'],
  },
  {
    classification: 'REJECTED',
    phrases: [
      'not moving forward',
      'other candidates',
      'will not be moving forward',
      'decided to move forward with other',
      'position has been filled',
      'not selected for this role',
    ],
  },
  {
    classification: 'INTERVIEW',
    phrases: [
      'schedule an interview',
      'schedule a call',
      'interview availability',
      'phone screen',
      'would like to interview',
      'invite you to interview',
    ],
  },
  {
    classification: 'ASSESSMENT',
    phrases: ['coding challenge', 'take-home', 'take home assignment', 'technical assessment', 'skills assessment'],
  },
  {
    classification: 'ACTION_REQUIRED',
    phrases: ['action required', 'missing document', 'please complete', 'additional information needed'],
  },
  {
    classification: 'APPLICATION_RECEIVED',
    phrases: [
      'application received',
      'thank you for applying',
      'thank you for your application',
      'we have received your application',
      'application has been submitted',
    ],
  },
];

const DETERMINISTIC_CONFIDENCE = 0.95;

export function classifyDeterministic(
  input: ClassifyDeterministicInput,
): DeterministicClassificationResult | null {
  const haystack = `${input.subject ?? ''} ${input.snippet}`.toLowerCase();

  for (const rule of RULES) {
    const matchedPhrase = rule.phrases.find((phrase) => haystack.includes(phrase));
    if (matchedPhrase) {
      return {
        classification: rule.classification,
        confidence: DETERMINISTIC_CONFIDENCE,
        evidence: `message contains "${matchedPhrase}"`,
      };
    }
  }

  return null;
}
