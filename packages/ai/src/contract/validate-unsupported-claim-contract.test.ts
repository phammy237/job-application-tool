import { describe, expect, it } from 'vitest';
import { validateUnsupportedClaimContract } from './validate-unsupported-claim-contract';

const FACT_ID = '11111111-1111-4111-8111-111111111111';
const ALLOWED = new Set([FACT_ID]);

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    supportStatus: 'SUPPORTED',
    citedFactIds: [FACT_ID],
    explanation: 'Matches the approved fact about the payments migration.',
    ...overrides,
  };
}

describe('validateUnsupportedClaimContract', () => {
  it('accepts a well-formed array whose length matches expectedLength and whose ids are allowlisted', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry()]),
      ALLOWED,
      1,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON as validation_failed', () => {
    const result = validateUnsupportedClaimContract('not json', ALLOWED, 1);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a schema violation (e.g. missing explanation) as validation_failed', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([{ supportStatus: 'SUPPORTED', citedFactIds: [FACT_ID] }]),
      ALLOWED,
      1,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an unrecognized supportStatus value as validation_failed', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry({ supportStatus: 'MAYBE' })]),
      ALLOWED,
      1,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a response array shorter than expectedLength as wrong_length', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry()]),
      ALLOWED,
      2,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'wrong_length' });
  });

  it('rejects a response array longer than expectedLength as wrong_length', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry(), validEntry()]),
      ALLOWED,
      1,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'wrong_length' });
  });

  it('checks wrong_length before checking fact-id allowlist — length mismatch wins', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([
        validEntry({ citedFactIds: ['99999999-9999-4999-8999-999999999999'] }),
      ]),
      ALLOWED,
      2,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'wrong_length' });
  });

  it('rejects an entry whose citedFactIds includes an id never offered in <candidate_facts>', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([
        validEntry({ citedFactIds: ['99999999-9999-4999-8999-999999999999'] }),
      ]),
      ALLOWED,
      1,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('accepts an UNSUPPORTED entry with an empty citedFactIds array', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry({ supportStatus: 'UNSUPPORTED', citedFactIds: [] })]),
      ALLOWED,
      1,
    );
    expect(result.status).toBe('ok');
  });

  it('accepts an UNCERTAIN entry with an empty citedFactIds array', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry({ supportStatus: 'UNCERTAIN', citedFactIds: [] })]),
      ALLOWED,
      1,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a response exceeding the max answers-per-check bound', () => {
    const many = Array.from({ length: 31 }, () => validEntry());
    const result = validateUnsupportedClaimContract(JSON.stringify(many), ALLOWED, 31);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('never accepts an answer-id or index field from the model — extra properties are stripped, not trusted', () => {
    const result = validateUnsupportedClaimContract(
      JSON.stringify([validEntry({ answerId: 'some-id', index: 0 })]),
      ALLOWED,
      1,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.entries[0]).not.toHaveProperty('answerId');
      expect(result.entries[0]).not.toHaveProperty('index');
    }
  });
});
