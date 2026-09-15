import { describe, expect, it } from 'vitest';
import { validateCompanyResearchContract } from './validate-company-research-contract';

const SOURCE_ID = '11111111-1111-1111-1111-111111111111';

describe('validateCompanyResearchContract', () => {
  it('accepts a well-formed plan', () => {
    const result = validateCompanyResearchContract(
      JSON.stringify({
        findings: [
          { category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID], requirementIds: [] },
        ],
      }),
    );
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    expect(validateCompanyResearchContract('not json')).toEqual({
      status: 'rejected',
      reason: 'validation_failed',
    });
  });

  it('rejects a finding with no sourceIds', () => {
    const result = validateCompanyResearchContract(
      JSON.stringify({ findings: [{ category: 'PRODUCT', claim: 'x', sourceIds: [] }] }),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an invalid category', () => {
    const result = validateCompanyResearchContract(
      JSON.stringify({
        findings: [{ category: 'MADE_UP', claim: 'x', sourceIds: [SOURCE_ID] }],
      }),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects too many findings', () => {
    const findings = Array.from({ length: 17 }, () => ({
      category: 'PRODUCT',
      claim: 'x',
      sourceIds: [SOURCE_ID],
    }));
    expect(validateCompanyResearchContract(JSON.stringify({ findings }))).toEqual({
      status: 'rejected',
      reason: 'validation_failed',
    });
  });

  it('rejects an oversized claim', () => {
    const result = validateCompanyResearchContract(
      JSON.stringify({
        findings: [
          { category: 'PRODUCT', claim: 'x'.repeat(501), sourceIds: [SOURCE_ID] },
        ],
      }),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('accepts an empty findings array (a valid "nothing useful found" answer)', () => {
    expect(validateCompanyResearchContract(JSON.stringify({ findings: [] }))).toEqual({
      status: 'ok',
      plan: { findings: [] },
    });
  });
});
