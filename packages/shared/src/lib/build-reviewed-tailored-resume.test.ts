import { describe, expect, it } from 'vitest';
import {
  createEmptyStructuredResume,
  type StructuredResumeV1,
} from '../schemas/resume-content';
import type {
  ResumeTailoringCoverage,
  ResumeTailoringOperationView,
} from '../schemas/resume-tailoring';
import type {
  ResumeTailoringOperationDecision,
  ResumeTailoringOperationEdit,
} from '../schemas/resume-tailoring-review';
import {
  buildReviewedTailoredResume,
  type ResumeTailoringOperationWithId,
} from './build-reviewed-tailored-resume';

const HEADER = {
  fullName: 'Ada Lovelace',
  email: null,
  phone: null,
  location: null,
  links: {},
};
const FACT_1 = '11111111-1111-1111-1111-111111111111';

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
          { id: 'b3', text: 'Wrote documentation', provenance: { type: 'MANUAL' } },
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
            id: 'b4',
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

const EMPTY_COVERAGE: ResumeTailoringCoverage = {
  totalRequirementCount: 0,
  coveredRequirementIds: [],
  unsupportedRequirementIds: [],
  referencedRequirementIds: [],
  unsupportedRequirements: [],
};

function op(
  operationId: string,
  operation: ResumeTailoringOperationView,
): ResumeTailoringOperationWithId {
  return { operationId, operation };
}

function decisions(
  entries: [string, ResumeTailoringOperationDecision][],
): Map<string, ResumeTailoringOperationDecision> {
  return new Map(entries);
}

function edits(
  entries: [string, ResumeTailoringOperationEdit][],
): Map<string, ResumeTailoringOperationEdit> {
  return new Map(entries);
}

const REWRITE_B1: ResumeTailoringOperationView = {
  type: 'REWRITE_BULLET',
  bulletId: 'b1',
  entryLabel: 'Engineer at Acme',
  before: 'Built the referral workflow',
  after: 'Led the referral workflow rebuild',
  groundedFacts: [{ id: FACT_1, label: 'Led a team of 5 engineers' }],
  relevantRequirements: [{ id: 'req-1', text: '5+ years of engineering experience' }],
  reason: 'Emphasizes leadership',
};

const ADD_TO_EXP1: ResumeTailoringOperationView = {
  type: 'ADD_BULLET',
  bulletId: 'exp-1',
  entryLabel: 'Engineer at Acme',
  after: 'Shipped the referral feature end to end',
  groundedFacts: [{ id: FACT_1, label: 'Led a team of 5 engineers' }],
  relevantRequirements: [{ id: 'req-2', text: 'Ownership of a feature end to end' }],
  reason: 'Adds grounded coverage',
};

const OMIT_B2: ResumeTailoringOperationView = {
  type: 'OMIT_BULLET',
  bulletId: 'b2',
  entryLabel: 'Engineer at Acme',
  omittedText: 'Improved onboarding flow',
  reason: 'Not relevant',
};

const OMIT_EXP2: ResumeTailoringOperationView = {
  type: 'OMIT_ENTRY',
  entryId: 'exp-2',
  entryLabel: 'Intern at Beta Corp',
  reason: 'Not relevant',
};

const MOVE_B3: ResumeTailoringOperationView = {
  type: 'MOVE_BULLET',
  bulletId: 'b3',
  entryLabel: 'Engineer at Acme',
  movedText: 'Wrote documentation',
  fromIndex: 2,
  toIndex: 0,
  reason: 'Lead with this',
};

const MOVE_EXP2: ResumeTailoringOperationView = {
  type: 'MOVE_ENTRY',
  entryId: 'exp-2',
  entryLabel: 'Intern at Beta Corp',
  fromIndex: 1,
  toIndex: 0,
  reason: 'Lead with this',
};

const REORDER: ResumeTailoringOperationView = {
  type: 'REORDER_SKILLS',
  before: ['Languages', 'Frameworks'],
  after: ['Frameworks', 'Languages'],
  orderedSkillGroupIds: ['skill-2', 'skill-1'],
  reason: 'Frameworks first',
};

describe('buildReviewedTailoredResume', () => {
  it('all-pending: résumé is unchanged from base, and it is reported as such', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(result.pendingOperationIds).toEqual(['op-0']);
    expect(result.counts).toEqual({
      total: 1,
      pending: 1,
      accepted: 0,
      rejected: 0,
      edited: 0,
    });
    expect(result.hasChangesFromBase).toBe(false);
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('Built the referral workflow');
  });

  it('single accept: applies exactly that operation, untouched, with CANDIDATE_FACTS provenance', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('Led the referral workflow rebuild');
    expect(bullet?.provenance).toEqual({
      type: 'CANDIDATE_FACTS',
      sourceFactIds: [FACT_1],
    });
    expect(result.acceptedOperationIds).toEqual(['op-0']);
    expect(result.hasChangesFromBase).toBe(true);
  });

  it('single reject: leaves the résumé exactly as the base — no durable trace of rejected text', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'REJECTED']]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('Built the referral workflow');
    expect(JSON.stringify(result.resume)).not.toContain(
      'Led the referral workflow rebuild',
    );
    expect(result.hasChangesFromBase).toBe(false);
  });

  it('edited rewrite, KEEP_GROUNDED, passes the guard: retains CANDIDATE_FACTS with the cited fact ids', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([
        [
          'op-0',
          {
            text: 'Led the referral rebuild for 5 engineers',
            provenanceChoice: 'KEEP_GROUNDED',
          },
        ],
      ]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('Led the referral rebuild for 5 engineers');
    expect(bullet?.provenance).toEqual({
      type: 'CANDIDATE_FACTS',
      sourceFactIds: [FACT_1],
    });
    expect(result.groundingViolations).toEqual([]);
    expect(result.editedOperationIds).toEqual(['op-0']);
  });

  it('edited rewrite, KEEP_GROUNDED, introduces an unsupported number: surfaces a violation and never claims grounding', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([
        ['op-0', { text: 'Grew revenue by $50M', provenanceChoice: 'KEEP_GROUNDED' }],
      ]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(result.groundingViolations).toEqual([
      {
        operationId: 'op-0',
        reason: 'ungrounded_number',
        detail: expect.stringContaining('$50M'),
      },
    ]);
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.provenance).toEqual({ type: 'MANUAL' });
  });

  it('edited rewrite, MANUAL: always succeeds and is never labeled fact-grounded, even with a wild claim', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([
        ['op-0', { text: 'Grew revenue by $50M', provenanceChoice: 'MANUAL' }],
      ]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(result.groundingViolations).toEqual([]);
    const bullet = result.resume.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('Grew revenue by $50M');
    expect(bullet?.provenance).toEqual({ type: 'MANUAL' });
  });

  it('edited add: same grounded/manual distinction applies to a newly added bullet', () => {
    const grounded = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', ADD_TO_EXP1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([
        [
          'op-0',
          {
            text: 'Shipped it end to end for the team',
            provenanceChoice: 'KEEP_GROUNDED',
          },
        ],
      ]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const addedGrounded = grounded.resume.experience[0]!.bullets.at(-1)!;
    expect(addedGrounded.text).toBe('Shipped it end to end for the team');
    expect(addedGrounded.provenance).toEqual({
      type: 'CANDIDATE_FACTS',
      sourceFactIds: [FACT_1],
    });

    const manual = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', ADD_TO_EXP1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([
        ['op-0', { text: 'Wrote a blog post about it', provenanceChoice: 'MANUAL' }],
      ]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const addedManual = manual.resume.experience[0]!.bullets.at(-1)!;
    expect(addedManual.text).toBe('Wrote a blog post about it');
    expect(addedManual.provenance).toEqual({ type: 'MANUAL' });
  });

  it('mixed decisions: only accepted operations show up in the result', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1), op('op-1', OMIT_B2), op('op-2', MOVE_B3)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'REJECTED'],
        ['op-2', 'PENDING'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const bullets = result.resume.experience[0]!.bullets;
    expect(bullets.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']); // b2 retained (rejected), b3 not moved (pending)
    expect(bullets[0]!.text).toBe('Led the referral workflow rebuild');
    expect(result.counts).toEqual({
      total: 3,
      pending: 1,
      accepted: 1,
      rejected: 1,
      edited: 0,
    });
  });

  it('omission accepted removes the bullet/entry; rejected retains it', () => {
    const accepted = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', OMIT_B2), op('op-1', OMIT_EXP2)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(accepted.resume.experience.map((e) => e.id)).toEqual(['exp-1']);
    expect(accepted.resume.experience[0]!.bullets.map((b) => b.id)).toEqual(['b1', 'b3']);

    const rejected = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', OMIT_B2), op('op-1', OMIT_EXP2)],
      decisions: decisions([
        ['op-0', 'REJECTED'],
        ['op-1', 'REJECTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(rejected.hasChangesFromBase).toBe(false);
  });

  it('move accepted repositions; rejected leaves the base position', () => {
    const accepted = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', MOVE_B3), op('op-1', MOVE_EXP2)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(accepted.resume.experience.map((e) => e.id)).toEqual(['exp-2', 'exp-1']);
    const exp1 = accepted.resume.experience.find((e) => e.id === 'exp-1')!;
    expect(exp1.bullets.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);

    const rejected = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', MOVE_B3), op('op-1', MOVE_EXP2)],
      decisions: decisions([
        ['op-0', 'REJECTED'],
        ['op-1', 'REJECTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(rejected.hasChangesFromBase).toBe(false);
  });

  it('skill reorder accepted/rejected', () => {
    const accepted = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REORDER)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(accepted.resume.skills.map((g) => g.id)).toEqual(['skill-2', 'skill-1']);

    const rejected = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REORDER)],
      decisions: decisions([['op-0', 'REJECTED']]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(rejected.resume.skills.map((g) => g.id)).toEqual(['skill-1', 'skill-2']);
  });

  it('never mutates the base résumé object', () => {
    const base = baseResume();
    const frozenSnapshot = JSON.parse(JSON.stringify(base));
    buildReviewedTailoredResume({
      baseResume: base,
      operations: [op('op-0', REWRITE_B1), op('op-1', ADD_TO_EXP1)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(base).toEqual(frozenSnapshot);
  });

  it('is deterministic for content and ordering given the same inputs', () => {
    const opsInput: ResumeTailoringOperationWithId[] = [
      op('op-0', OMIT_B2),
      op('op-1', MOVE_B3),
    ];
    const decisionMap = decisions([
      ['op-0', 'ACCEPTED'],
      ['op-1', 'ACCEPTED'],
    ]);
    const first = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: opsInput,
      decisions: decisionMap,
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const second = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: opsInput,
      decisions: decisionMap,
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(first.resume.experience[0]!.bullets.map((b) => b.text)).toEqual(
      second.resume.experience[0]!.bullets.map((b) => b.text),
    );
  });

  it('always resets renderOverride, even when the base résumé had one', () => {
    const base = {
      ...baseResume(),
      renderOverride: { latex: '\\documentclass{article}' },
    };
    const result = buildReviewedTailoredResume({
      baseResume: base,
      operations: [],
      decisions: decisions([]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    expect(result.resume.renderOverride).toBeNull();
    // Purely resetting the override with zero content operations is still "no changes."
    expect(result.hasChangesFromBase).toBe(false);
  });

  it('recomputes coverage from only accepted operations — rejecting the only citing operation drops coverage', () => {
    const originalCoverage: ResumeTailoringCoverage = {
      totalRequirementCount: 2,
      coveredRequirementIds: ['req-1'],
      unsupportedRequirementIds: ['req-2'],
      referencedRequirementIds: ['req-1'],
      unsupportedRequirements: [{ id: 'req-2', text: 'Experience with Snowflake' }],
    };
    const rejected = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'REJECTED']]),
      edits: edits([]),
      originalCoverage,
    });
    expect(rejected.coverage.coveredRequirementIds).toEqual([]);
    expect(rejected.coverage.unsupportedRequirementIds.sort()).toEqual([
      'req-1',
      'req-2',
    ]);
    expect(rejected.coverage.totalRequirementCount).toBe(2);

    const accepted = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', REWRITE_B1)],
      decisions: decisions([['op-0', 'ACCEPTED']]),
      edits: edits([]),
      originalCoverage,
    });
    expect(accepted.coverage.coveredRequirementIds).toEqual(['req-1']);
    expect(accepted.coverage.unsupportedRequirementIds).toEqual(['req-2']);
  });

  it('produces no duplicate ids anywhere after a mix of adds/omits/moves', () => {
    const result = buildReviewedTailoredResume({
      baseResume: baseResume(),
      operations: [op('op-0', ADD_TO_EXP1), op('op-1', OMIT_B2), op('op-2', MOVE_B3)],
      decisions: decisions([
        ['op-0', 'ACCEPTED'],
        ['op-1', 'ACCEPTED'],
        ['op-2', 'ACCEPTED'],
      ]),
      edits: edits([]),
      originalCoverage: EMPTY_COVERAGE,
    });
    const allIds = result.resume.experience.flatMap((e) => [
      e.id,
      ...e.bullets.map((b) => b.id),
    ]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
