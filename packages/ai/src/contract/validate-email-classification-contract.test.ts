import { describe, expect, it } from 'vitest';
import { validateEmailClassificationContract } from './validate-email-classification-contract';

function validContract(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    classification: 'INTERVIEW',
    confidence: 0.92,
    evidence: "subject contains 'interview'",
    ...overrides,
  });
}

describe('validateEmailClassificationContract', () => {
  it('accepts a well-formed response', () => {
    const result = validateEmailClassificationContract(validContract());
    expect(result).toEqual({
      status: 'ok',
      result: { classification: 'INTERVIEW', confidence: 0.92, evidence: "subject contains 'interview'" },
    });
  });

  it('rejects malformed JSON', () => {
    const result = validateEmailClassificationContract('not json at all {{{');
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a classification outside the enum', () => {
    const result = validateEmailClassificationContract(validContract({ classification: 'SOMETHING_ELSE' }));
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an out-of-range confidence value', () => {
    const result = validateEmailClassificationContract(validContract({ confidence: 1.5 }));
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects evidence over 200 characters', () => {
    const result = validateEmailClassificationContract(validContract({ evidence: 'x'.repeat(201) }));
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('accepts every classification value in the enum', () => {
    const values = [
      'APPLICATION_RECEIVED',
      'ASSESSMENT',
      'INTERVIEW',
      'ACTION_REQUIRED',
      'OFFER',
      'REJECTED',
      'OTHER',
    ];
    for (const classification of values) {
      const result = validateEmailClassificationContract(validContract({ classification }));
      expect(result.status).toBe('ok');
    }
  });
});
