import { describe, expect, it } from 'vitest';
import { validateInterviewPrepContract } from './validate-interview-prep-contract';

const FACT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';
const FINDING_ID = '55555555-5555-4555-8555-555555555555';

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

const ALLOWLISTS = {
  factIds: new Set([FACT_ID]),
  factTextById: new Map([[FACT_ID, 'Led the referral workflow rebuild']]),
  requirementIds: new Set([REQUIREMENT_ID]),
  researchFindingIds: new Set<string>(),
};

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
      ALLOWLISTS,
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
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    expect(validateInterviewPrepContract('not json', ALLOWLISTS)).toEqual({
      status: 'rejected',
      reason: 'validation_failed',
    });
  });

  it('rejects a schema violation (missing required array)', () => {
    expect(
      validateInterviewPrepContract(JSON.stringify({ rolePriorities: [] }), ALLOWLISTS),
    ).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects an evidenceToEmphasize sourceFactIds entry outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        evidenceToEmphasize: [{ theme: 'x', sourceFactIds: [UNKNOWN_ID], summary: 'y' }],
      }),
      ALLOWLISTS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a starStoryPrompts sourceFactIds entry outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        starStoryPrompts: [{ competency: 'x', sourceFactIds: [UNKNOWN_ID], prompt: 'y' }],
      }),
      ALLOWLISTS,
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
      ALLOWLISTS,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects a gapsToPrepare sourceRequirementId outside the allowed set', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        gapsToPrepare: [{ requirement: 'x', sourceRequirementId: UNKNOWN_ID, note: 'y' }],
      }),
      ALLOWLISTS,
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
      ALLOWLISTS,
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
      { ...ALLOWLISTS, requirementIds: new Set() },
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });
});

describe('validateInterviewPrepContract — Phase 7I researchFindingIds', () => {
  const ALLOWLISTS_WITH_RESEARCH = { ...ALLOWLISTS, researchFindingIds: new Set([FINDING_ID]) };

  it('accepts a valid researchFindingIds citation on any item type', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        questionsToAsk: [
          { question: 'x', rationale: 'y', researchFindingIds: [FINDING_ID] },
        ],
      }),
      ALLOWLISTS_WITH_RESEARCH,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a researchFindingIds citation not offered in this request', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        gapsToPrepare: [
          {
            requirement: 'x',
            sourceRequirementId: null,
            note: 'y',
            researchFindingIds: [UNKNOWN_ID],
          },
        ],
      }),
      ALLOWLISTS_WITH_RESEARCH,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('rejects any researchFindingIds citation when no research context was offered at all (empty allowlist)', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        rolePriorities: [
          {
            requirement: 'x',
            importance: 'REQUIRED',
            sourceRequirementId: null,
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
      ALLOWLISTS, // researchFindingIds allowlist is empty here
    );
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_source_fact_id' });
  });

  it('CRITICAL: citing a research finding never grounds a technology claim absent from cited facts', () => {
    // ALLOWLISTS' only fact says nothing about Snowflake — citing FINDING_ID must not launder it.
    const result = validateInterviewPrepContract(
      prepJson({
        evidenceToEmphasize: [
          {
            theme: 'Data platform experience',
            sourceFactIds: [FACT_ID],
            summary: 'Emphasize your Snowflake pipeline experience',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
      ALLOWLISTS_WITH_RESEARCH,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'ungrounded_technology' });
  });

  it('CRITICAL: citing a research finding never grounds a numeric claim absent from cited facts', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        starStoryPrompts: [
          {
            competency: 'Scale',
            sourceFactIds: [FACT_ID],
            prompt: 'Tell them about the time you drove $10B in company revenue',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
      ALLOWLISTS_WITH_RESEARCH,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'ungrounded_number' });
  });

  it('a candidate claim independently grounded by cited facts still passes even when research is also cited', () => {
    const result = validateInterviewPrepContract(
      prepJson({
        evidenceToEmphasize: [
          {
            theme: 'Referral workflow',
            sourceFactIds: [FACT_ID],
            summary: 'Discuss the referral workflow rebuild',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
      ALLOWLISTS_WITH_RESEARCH,
    );
    expect(result.status).toBe('ok');
  });
});
