import { describe, expect, it } from 'vitest';
import { extractSponsorshipSignal } from './extract-sponsorship-signal';

describe('extractSponsorshipSignal', () => {
  const negativeExamples = [
    'We are unable to sponsor employment visas at this time.',
    'Unfortunately we cannot offer visa sponsorship for this role, so there is no sponsorship available.',
    'Applicants must not require sponsorship now or in the future.',
    'Candidates must be authorized to work without sponsorship.',
    'We are unable to provide visa sponsorship for this position.',
  ];

  for (const example of negativeExamples) {
    it(`detects NOT_AVAILABLE: "${example}"`, () => {
      const result = extractSponsorshipSignal(example);
      expect(result.signal).toBe('NOT_AVAILABLE');
      expect(result.evidence).toBeTruthy();
    });
  }

  const positiveExamples = [
    'Visa sponsorship is available for this role.',
    'We sponsor H-1B visas for qualified candidates.',
    'Sponsorship available for the right candidate.',
    'OPT candidates welcome to apply.',
    'CPT candidates welcome to apply.',
  ];

  for (const example of positiveExamples) {
    it(`detects AVAILABLE: "${example}"`, () => {
      const result = extractSponsorshipSignal(example);
      expect(result.signal).toBe('AVAILABLE');
      expect(result.evidence).toBeTruthy();
    });
  }

  it('returns UNKNOWN on silence', () => {
    const result = extractSponsorshipSignal('We are a fast-growing fintech company building the future.');
    expect(result.signal).toBe('UNKNOWN');
    expect(result.evidence).toBeNull();
  });

  it('returns UNKNOWN on ambiguous wording that matches neither explicit pattern', () => {
    const result = extractSponsorshipSignal('We value diversity and welcome candidates from all backgrounds.');
    expect(result.signal).toBe('UNKNOWN');
  });

  it('bounds evidence length', () => {
    const longSentence = `We are unable to sponsor visas. ${'x'.repeat(500)}.`;
    const result = extractSponsorshipSignal(longSentence);
    expect(result.evidence?.length).toBeLessThanOrEqual(301);
  });
});
