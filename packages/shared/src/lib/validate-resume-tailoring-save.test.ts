import { describe, expect, it } from 'vitest';
import {
  createEmptyStructuredResume,
  type StructuredResumeV1,
} from '../schemas/resume-content';
import type { ResumeTailoringOperationView } from '../schemas/resume-tailoring';
import type {
  ResumeTailoringOperationDecision,
  ResumeTailoringOperationEdit,
} from '../schemas/resume-tailoring-review';
import type { ResumeTailoringOperationWithId } from './build-reviewed-tailored-resume';
import { validateResumeTailoringSaveSubmission } from './validate-resume-tailoring-save';

const HEADER = {
  fullName: 'Ada Lovelace',
  email: null,
  phone: null,
  location: null,
  links: {},
};
const FACT_1 = '11111111-1111-1111-1111-111111111111';
const FOREIGN_FACT = '99999999-9999-9999-9999-999999999999';

function baseResume(): StructuredResumeV1 {
  return {
    ...createEmptyStructuredResume(HEADER),
    experience: [
      {
        id: 'exp-1',
        organization: 'Acme',
        role: 'Engineer',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [
          {
            id: 'b1',
            text: 'Built the referral workflow',
            provenance: { type: 'MANUAL' },
          },
          { id: 'b2', text: 'Improved onboarding flow', provenance: { type: 'MANUAL' } },
        ],
      },
      {
        id: 'exp-2',
        organization: 'Beta Corp',
        role: 'Intern',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [
          {
            id: 'b3',
            text: 'Assisted with support tickets',
            provenance: { type: 'MANUAL' },
          },
        ],
      },
    ],
    skills: [
      { id: 'skill-1', label: 'Languages', items: ['Python'] },
      { id: 'skill-2', label: 'Frameworks', items: ['React'] },
    ],
  };
}

const APPROVED_FACTS = new Set([FACT_1]);
const FACT_TEXT = new Map([[FACT_1, 'Led a team of 5 engineers']]);

function op(
  operationId: string,
  operation: ResumeTailoringOperationView,
): ResumeTailoringOperationWithId {
  return { operationId, operation };
}
function decisions(entries: [string, ResumeTailoringOperationDecision][]) {
  return new Map(entries);
}
function edits(entries: [string, ResumeTailoringOperationEdit][]) {
  return new Map(entries);
}

const REWRITE_B1: ResumeTailoringOperationView = {
  type: 'REWRITE_BULLET',
  bulletId: 'b1',
  entryLabel: 'Engineer at Acme',
  before: 'Built the referral workflow',
  after: 'Led the referral workflow rebuild for 5 engineers',
  groundedFacts: [{ id: FACT_1, label: 'Led a team of 5 engineers' }],
  relevantRequirements: [],
  reason: 'x',
};

function validate(
  overrides: Partial<{
    operations: ResumeTailoringOperationWithId[];
    decisions: Map<string, ResumeTailoringOperationDecision>;
    edits: Map<string, ResumeTailoringOperationEdit>;
    approvedFactIds: ReadonlySet<string>;
    factTextById: ReadonlyMap<string, string>;
    baseResume: StructuredResumeV1;
  }> = {},
) {
  return validateResumeTailoringSaveSubmission({
    baseResume: overrides.baseResume ?? baseResume(),
    operations: overrides.operations ?? [op('op-0', REWRITE_B1)],
    decisions: overrides.decisions ?? decisions([['op-0', 'ACCEPTED']]),
    edits: overrides.edits ?? edits([]),
    approvedFactIds: overrides.approvedFactIds ?? APPROVED_FACTS,
    factTextById: overrides.factTextById ?? FACT_TEXT,
  });
}

describe('validateResumeTailoringSaveSubmission', () => {
  it('accepts a well-formed, fully-resolved, grounded submission', () => {
    expect(validate()).toEqual({ status: 'ok' });
  });

  it('rejects when any operation is left PENDING', () => {
    const result = validate({ decisions: decisions([]) });
    expect(result).toMatchObject({ status: 'rejected', reason: 'unresolved_operations' });
  });

  it('rejects an ACCEPTED operation referencing a bulletId not in the base résumé', () => {
    const result = validate({
      operations: [op('op-0', { ...REWRITE_B1, bulletId: 'not-real' })],
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_bullet_id' });
  });

  it('rejects an ACCEPTED ADD_BULLET targeting an entry not in the base résumé', () => {
    const addOp: ResumeTailoringOperationView = {
      type: 'ADD_BULLET',
      bulletId: 'not-real-entry',
      entryLabel: 'x',
      after: 'New bullet',
      groundedFacts: [{ id: FACT_1, label: 'Led a team of 5 engineers' }],
      relevantRequirements: [],
      reason: 'x',
    };
    const result = validate({ operations: [op('op-0', addOp)] });
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_entry_id' });
  });

  it("rejects a REORDER_SKILLS whose ids are not exactly the base résumé's own skill groups", () => {
    const reorder: ResumeTailoringOperationView = {
      type: 'REORDER_SKILLS',
      before: ['Languages', 'Frameworks'],
      after: ['Frameworks', 'Made Up'],
      orderedSkillGroupIds: ['skill-2', 'not-real'],
      reason: 'x',
    };
    const result = validate({
      operations: [op('op-0', reorder)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_skill_reorder' });
  });

  it('rejects two ACCEPTED operations exclusively targeting the same bulletId', () => {
    const move: ResumeTailoringOperationView = {
      type: 'MOVE_BULLET',
      bulletId: 'b1',
      entryLabel: 'Engineer at Acme',
      movedText: 'Built the referral workflow',
      fromIndex: 0,
      toIndex: 1,
      reason: 'x',
    };
    const result = validate({
      operations: [op('op-0', REWRITE_B1), op('op-1', move)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
      ]),
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects an ACCEPTED bullet operation whose entry is also ACCEPTED for OMIT_ENTRY', () => {
    const omitEntry: ResumeTailoringOperationView = {
      type: 'OMIT_ENTRY',
      entryId: 'exp-1',
      entryLabel: 'Engineer at Acme',
      reason: 'x',
    };
    const result = validate({
      operations: [op('op-0', REWRITE_B1), op('op-1', omitEntry)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
      ]),
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects an untouched grounded operation citing a fact id outside the fresh approved set (cross-user/revoked)', () => {
    const foreignOp: ResumeTailoringOperationView = {
      ...REWRITE_B1,
      groundedFacts: [{ id: FOREIGN_FACT, label: 'Fabricated label claiming grounding' }],
    };
    const result = validate({ operations: [op('op-0', foreignOp)] });
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'unknown_fact_id',
      detail: FOREIGN_FACT,
    });
  });

  it('never trusts the client-supplied groundedFacts label as evidence — re-checks against the REAL fact text', () => {
    // The client claims this text is grounded by FACT_1, but FACT_1's real text (from the fresh
    // server-side map) says nothing about "$50M" — only the client's own (irrelevant) label does.
    const spoofed: ResumeTailoringOperationView = {
      ...REWRITE_B1,
      after: 'Grew revenue by $50M',
      groundedFacts: [{ id: FACT_1, label: 'Grew revenue by $50M (fabricated label)' }],
    };
    const result = validate({ operations: [op('op-0', spoofed)] });
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_number' });
  });

  it('never re-runs grounding for a MANUAL-choice edit — any text is allowed', () => {
    const result = validate({
      edits: edits([
        ['op-0', { text: 'Grew revenue by $50M', provenanceChoice: 'MANUAL' }],
      ]),
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('re-runs grounding for a KEEP_GROUNDED edit against the REAL original bullet text and REAL fact text', () => {
    const passing = validate({
      edits: edits([
        [
          'op-0',
          {
            text: 'Led the workflow rebuild with 5 engineers',
            provenanceChoice: 'KEEP_GROUNDED',
          },
        ],
      ]),
    });
    expect(passing).toEqual({ status: 'ok' });

    const failing = validate({
      edits: edits([
        [
          'op-0',
          {
            text: 'Led the workflow rebuild worth $50M',
            provenanceChoice: 'KEEP_GROUNDED',
          },
        ],
      ]),
    });
    expect(failing).toMatchObject({ status: 'rejected', reason: 'ungrounded_number' });
  });

  it('rejects an ungrounded technology token introduced by an edit', () => {
    const result = validate({
      edits: edits([
        [
          'op-0',
          {
            text: 'Led the referral rebuild using Kubernetes',
            provenanceChoice: 'KEEP_GROUNDED',
          },
        ],
      ]),
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_technology' });
  });

  it('ignores REJECTED operations entirely for every check', () => {
    const result = validate({
      operations: [
        op('op-0', {
          ...REWRITE_B1,
          bulletId: 'not-real',
          groundedFacts: [{ id: FOREIGN_FACT, label: 'x' }],
        }),
      ],
      decisions: decisions([['op-0', 'REJECTED']]),
    });
    expect(result).toEqual({ status: 'ok' });
  });
});
