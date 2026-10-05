import { describe, expect, it } from 'vitest';
import { validateResumeTailoringContract } from './validate-resume-tailoring-contract';

function rewriteOp(overrides: Record<string, unknown> = {}) {
  return {
    type: 'REWRITE_BULLET',
    bulletId: 'b1',
    proposedText: 'New text',
    sourceFactIds: [],
    requirementIds: [],
    reason: 'x',
    ...overrides,
  };
}

function validPlan(operations: unknown[] = [rewriteOp()]): string {
  return JSON.stringify({ operations });
}

describe('validateResumeTailoringContract', () => {
  it('accepts a well-formed plan with one operation', () => {
    const result = validateResumeTailoringContract(validPlan());
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.plan.operations).toHaveLength(1);
    }
  });

  it('accepts a plan with zero operations', () => {
    const result = validateResumeTailoringContract(validPlan([]));
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    const result = validateResumeTailoringContract('not json at all {{{');
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a response missing the operations field entirely', () => {
    const result = validateResumeTailoringContract(JSON.stringify({}));
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an operation with an unknown type', () => {
    const result = validateResumeTailoringContract(
      validPlan([{ ...rewriteOp(), type: 'DELETE_EVERYTHING' }]),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an ADD_BULLET operation with zero cited facts — grounding is required at the shape level', () => {
    const result = validateResumeTailoringContract(
      validPlan([
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'New bullet',
          sourceFactIds: [],
          requirementIds: [],
          reason: 'x',
        },
      ]),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('strips unknown fields on an operation rather than rejecting (e.g. an injected latexSource)', () => {
    const result = validateResumeTailoringContract(
      validPlan([{ ...rewriteOp(), latexSource: '\\textbf{hacked}' }]),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.plan.operations[0]).not.toHaveProperty('latexSource');
    }
  });
});
