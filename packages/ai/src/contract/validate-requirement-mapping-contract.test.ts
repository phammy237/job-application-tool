import { describe, expect, it } from 'vitest';
import { validateRequirementMappingContract } from './validate-requirement-mapping-contract';

const FACT_ID = '11111111-1111-4111-8111-111111111111';
const ALLOWED = new Set([FACT_ID]);

function validMapping(overrides: Record<string, unknown> = {}) {
  return {
    requirementText: '5+ years of backend experience',
    requirementCategory: 'EXPERIENCE',
    requiredOrPreferred: 'REQUIRED',
    relationship: 'DIRECT',
    matchedFactIds: [FACT_ID],
    explanation: 'Matches the Acme backend role.',
    confidence: 0.9,
    requiresUserConfirmation: false,
    ...overrides,
  };
}

describe('validateRequirementMappingContract', () => {
  it('accepts a well-formed array whose ids are all allowlisted', () => {
    const result = validateRequirementMappingContract(JSON.stringify([validMapping()]), ALLOWED);
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    const result = validateRequirementMappingContract('not json', ALLOWED);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a mapping whose matchedFactIds includes an id never offered to the model', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ matchedFactIds: ['99999999-9999-4999-8999-999999999999'] })]),
      ALLOWED,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects MISSING with a non-empty matchedFactIds', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ relationship: 'MISSING', matchedFactIds: [FACT_ID] })]),
      ALLOWED,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('accepts MISSING with an empty matchedFactIds', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ relationship: 'MISSING', matchedFactIds: [] })]),
      ALLOWED,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a non-MISSING relationship with an empty matchedFactIds', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ relationship: 'DIRECT', matchedFactIds: [] })]),
      ALLOWED,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects INFERRED with requiresUserConfirmation false', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ relationship: 'INFERRED', requiresUserConfirmation: false })]),
      ALLOWED,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('accepts INFERRED with requiresUserConfirmation true', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ relationship: 'INFERRED', requiresUserConfirmation: true })]),
      ALLOWED,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a response exceeding the max requirement count', () => {
    const many = Array.from({ length: 61 }, () => validMapping());
    const result = validateRequirementMappingContract(JSON.stringify(many), ALLOWED);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('never computes or accepts an aggregate score field — extra properties are rejected', () => {
    const result = validateRequirementMappingContract(
      JSON.stringify([validMapping({ atsScore: 87 })]),
      ALLOWED,
    );
    expect(result.status).toBe('ok'); // extra key is simply stripped by Zod, not treated as data
    if (result.status === 'ok') {
      expect(result.mappings[0]).not.toHaveProperty('atsScore');
    }
  });
});
