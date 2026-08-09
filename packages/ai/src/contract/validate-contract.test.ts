import { describe, expect, it } from 'vitest';
import { validateContract } from './validate-contract';

const FACT_A = '11111111-1111-4111-8111-111111111111';
const FACT_B = '22222222-2222-4222-8222-222222222222';
const ALLOWED = new Set([FACT_A, FACT_B]);

function validContract(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    answer: 'Built the payments service handling 2M requests/day.',
    confidence: 0.8,
    sourceFactIds: [FACT_A],
    reasoningSummary: 'Based on your Acme Corp backend role.',
    unsupportedClaims: [],
    requiresUserReview: true,
    ...overrides,
  });
}

describe('validateContract — this is the "rejection gate actually rejects" proof', () => {
  it('accepts a well-formed, fully-supported response', () => {
    const result = validateContract(validContract(), ALLOWED);
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON, with no answer to persist', () => {
    const result = validateContract('not json at all {{{', ALLOWED);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed', answer: null });
  });

  it('rejects an out-of-range confidence value, with no answer to persist', () => {
    const result = validateContract(validContract({ confidence: 1.5 }), ALLOWED);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed', answer: null });
  });

  it('rejects an empty sourceFactIds array, with no answer to persist', () => {
    const result = validateContract(validContract({ sourceFactIds: [] }), ALLOWED);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed', answer: null });
  });

  it('rejects a reasoningSummary over 400 characters, with no answer to persist', () => {
    const result = validateContract(
      validContract({ reasoningSummary: 'x'.repeat(401) }),
      ALLOWED,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed', answer: null });
  });

  it('rejects a sourceFactId that was never placed in the prompt, but carries the answer for audit', () => {
    const unknownId = '33333333-3333-4333-8333-333333333333';
    const result = validateContract(validContract({ sourceFactIds: [unknownId] }), ALLOWED);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected' && result.reason === 'unknown_source_fact_id') {
      expect(result.answer.sourceFactIds).toEqual([unknownId]);
    } else {
      throw new Error('expected unknown_source_fact_id rejection');
    }
  });

  it('rejects a non-empty unsupportedClaims self-report, but carries the structurally-valid answer for audit', () => {
    const result = validateContract(
      validContract({ unsupportedClaims: ['claims a certification not in any provided fact'] }),
      ALLOWED,
    );
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected' && result.reason === 'unsupported_claims_present') {
      expect(result.answer.unsupportedClaims).toHaveLength(1);
    } else {
      throw new Error('expected unsupported_claims_present rejection');
    }
  });

  it('accepts a response citing multiple allowed facts', () => {
    const result = validateContract(validContract({ sourceFactIds: [FACT_A, FACT_B] }), ALLOWED);
    expect(result.status).toBe('ok');
  });
});
