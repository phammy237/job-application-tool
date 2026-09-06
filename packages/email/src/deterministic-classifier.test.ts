import { describe, expect, it } from 'vitest';
import { classifyDeterministic } from './deterministic-classifier';
import { LABELED_EMAILS } from './fixtures/labeled-emails';

describe('classifyDeterministic — labeled fixture set', () => {
  for (const fixture of LABELED_EMAILS) {
    it(fixture.label, () => {
      const result = classifyDeterministic({ subject: fixture.subject, snippet: fixture.snippet });
      if (fixture.expectedClassification === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result?.classification).toBe(fixture.expectedClassification);
        expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result?.evidence.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('classifyDeterministic — matching is case-insensitive', () => {
  it('matches regardless of case', () => {
    const result = classifyDeterministic({
      subject: 'YOUR OFFER FROM ACME',
      snippet: 'We are PLEASED TO OFFER you the role.',
    });
    expect(result?.classification).toBe('OFFER');
  });
});
