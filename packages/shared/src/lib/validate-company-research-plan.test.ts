import { describe, expect, it } from 'vitest';
import type { CompanyResearchPlanContract } from '../schemas/company-research-contract';
import { validateCompanyResearchPlan } from './validate-company-research-plan';

const SOURCE_1 = '11111111-1111-1111-1111-111111111111';
const SOURCE_2 = '22222222-2222-2222-2222-222222222222';
const FOREIGN_SOURCE = '99999999-9999-9999-9999-999999999999';

const ALLOWLISTS = {
  sourceIds: new Set([SOURCE_1, SOURCE_2]),
  requirementIds: new Set(['req-1', 'req-2']),
};

function plan(
  overrides: Partial<CompanyResearchPlanContract> = {},
): CompanyResearchPlanContract {
  return {
    findings: [
      {
        category: 'PRODUCT',
        claim: 'Acme launched a new product.',
        roleRelevance: 'Relevant because the role builds this product.',
        sourceIds: [SOURCE_1],
        requirementIds: ['req-1'],
      },
    ],
    ...overrides,
  };
}

describe('validateCompanyResearchPlan', () => {
  it('accepts a well-formed plan citing only offered sources/requirements', () => {
    expect(validateCompanyResearchPlan(plan(), ALLOWLISTS)).toEqual({
      status: 'ok',
      findings: plan().findings,
    });
  });

  it('rejects a plan with zero findings', () => {
    const result = validateCompanyResearchPlan(plan({ findings: [] }), ALLOWLISTS);
    expect(result).toMatchObject({ status: 'rejected', reason: 'no_findings' });
  });

  it('rejects a finding citing a source id never offered in this request', () => {
    const result = validateCompanyResearchPlan(
      plan({ findings: [{ ...plan().findings[0]!, sourceIds: [FOREIGN_SOURCE] }] }),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_source_id' });
  });

  it('rejects a finding citing a requirement id never offered in this request', () => {
    const result = validateCompanyResearchPlan(
      plan({ findings: [{ ...plan().findings[0]!, requirementIds: ['req-unknown'] }] }),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'unknown_requirement_id',
    });
  });

  it('accepts a finding with no requirement ids at all', () => {
    const result = validateCompanyResearchPlan(
      plan({ findings: [{ ...plan().findings[0]!, requirementIds: [] }] }),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('accepts a finding citing multiple valid sources', () => {
    const result = validateCompanyResearchPlan(
      plan({ findings: [{ ...plan().findings[0]!, sourceIds: [SOURCE_1, SOURCE_2] }] }),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects the entire plan if any one of several findings is invalid (all-or-nothing)', () => {
    const result = validateCompanyResearchPlan(
      plan({
        findings: [
          plan().findings[0]!,
          { ...plan().findings[0]!, sourceIds: [FOREIGN_SOURCE] },
        ],
      }),
      ALLOWLISTS,
    );
    expect(result.status).toBe('rejected');
  });
});
