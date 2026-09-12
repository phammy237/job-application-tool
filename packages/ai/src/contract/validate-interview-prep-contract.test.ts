import { describe, expect, it } from 'vitest';
import { validateInterviewPrepContract } from './validate-interview-prep-contract';

const FACT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

function prepJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rolePriorities: [],
    evidenceToEmphasize: [],
    starStoryPrompts: [],
    possibleQuestions: [],
    questionsToAsk: [],
    gapsToPrepare: [],
    ...overrides,
  });
}

const ALLOWED_FACT_IDS = new Set([FACT_ID]);
const ALLOWED_REQUIREMENT_IDS = new Set([REQUIREMENT_ID]);

describe('validateInterviewPrepContract', () => {
  it('accepts a well-formed, fully-cited contract', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        rolePriorities: [
          {
            requirement: 'x',
            importance: 'REQUIRED',
            sourceRequirementId: REQUIREMENT_ID,
          },
        ],
        evidenceToEmphasize: [{ theme: 'x', sourceFactIds: [FACT_ID], summary: 'y' }],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result.status).toBe('ok');
  });

  it('accepts null sourceRequirementId and empty sourceRequirementIds/sourceFactIds', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        rolePriorities: [
          { requirement: 'x', importance: 'REQUIRED', sourceRequirementId: null },
        ],
        possibleQuestions: [{ question: 'x', rationale: 'y', sourceRequirementIds: [] }],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    expect(
      validateInterviewPrepContract(
        'not json',
        ALLOWED_FACT_IDS,
        ALLOWED_REQUIREMENT_IDS,
      ),
    ).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a schema violation (missing required array)', () => {
    expect(
      validateInterviewPrepContract(
        JSON.stringify({ rolePriorities: [] }),
        ALLOWED_FACT_IDS,
        ALLOWED_REQUIREMENT_IDS,
      ),
    ).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an evidenceToEmphasize sourceFactIds entry outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        evidenceToEmphasize: [{ theme: 'x', sourceFactIds: [UNKNOWN_ID], summary: 'y' }],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a starStoryPrompts sourceFactIds entry outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        starStoryPrompts: [{ competency: 'x', sourceFactIds: [UNKNOWN_ID], prompt: 'y' }],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a rolePriorities sourceRequirementId outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        rolePriorities: [
          { requirement: 'x', importance: 'REQUIRED', sourceRequirementId: UNKNOWN_ID },
        ],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a gapsToPrepare sourceRequirementId outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        gapsToPrepare: [{ requirement: 'x', sourceRequirementId: UNKNOWN_ID, note: 'y' }],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a possibleQuestions sourceRequirementIds entry outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        possibleQuestions: [
          { question: 'x', rationale: 'y', sourceRequirementIds: [UNKNOWN_ID] },
        ],
      }),
      ALLOWED_FACT_IDS,
      ALLOWED_REQUIREMENT_IDS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects any requirement id when the allowed set is empty (no current mapping)', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        rolePriorities: [
          {
            requirement: 'x',
            importance: 'REQUIRED',
            sourceRequirementId: REQUIREMENT_ID,
          },
        ],
      }),
      ALLOWED_FACT_IDS,
      new Set(),
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });
});
