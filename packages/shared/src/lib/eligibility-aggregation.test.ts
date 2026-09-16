import { describe, expect, it } from 'vitest';
import { aggregateEligibility } from './eligibility-aggregation';
import type { EligibilityCheck } from '../schemas/eligibility-check';

function check(overrides: Partial<EligibilityCheck> & { status: EligibilityCheck['status'] }): EligibilityCheck {
  return {
    type: 'SPONSORSHIP',
    reasonCode: 'TEST',
    explanation: 'test',
    evidenceText: null,
    sourceField: null,
    ...overrides,
  };
}

describe('aggregateEligibility', () => {
  it('any CONFLICT makes the overall status CONFLICT, even alongside ELIGIBLE/UNKNOWN', () => {
    const result = aggregateEligibility([
      check({ status: 'ELIGIBLE' }),
      check({ status: 'UNKNOWN', type: 'CITIZENSHIP' }),
      check({ status: 'CONFLICT', type: 'SECURITY_CLEARANCE' }),
    ]);
    expect(result.overallStatus).toBe('CONFLICT');
  });

  it('an unresolved relevant check with no conflict makes the overall status UNKNOWN', () => {
    const result = aggregateEligibility([
      check({ status: 'ELIGIBLE' }),
      check({ status: 'UNKNOWN', type: 'CITIZENSHIP' }),
    ]);
    expect(result.overallStatus).toBe('UNKNOWN');
  });

  it('all applicable checks passing makes the overall status ELIGIBLE', () => {
    const result = aggregateEligibility([
      check({ status: 'ELIGIBLE' }),
      check({ status: 'ELIGIBLE', type: 'CITIZENSHIP' }),
    ]);
    expect(result.overallStatus).toBe('ELIGIBLE');
  });

  it('zero applicable checks is vacuously ELIGIBLE', () => {
    const result = aggregateEligibility([]);
    expect(result.overallStatus).toBe('ELIGIBLE');
    expect(result.checks).toEqual([]);
  });
});
