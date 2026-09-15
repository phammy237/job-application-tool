import { describe, expect, it } from 'vitest';
import { createEmptyStructuredResume, type StructuredResumeV1 } from '../schemas/resume-content';
import type { ResumeTailoringOperation } from '../schemas/resume-tailoring';
import {
  validateResumeTailoringPlan,
  type ResumeTailoringAllowlists,
} from './validate-resume-tailoring-plan';

const HEADER = { fullName: 'Ada Lovelace', email: null, phone: null, location: null, links: {} };

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
          { id: 'b1', text: 'Built the referral workflow', provenance: { type: 'MANUAL' } },
          { id: 'b2', text: 'Improved onboarding flow', provenance: { type: 'MANUAL' } },
        ],
      },
      {
        id: 'exp-2',
        organization: 'Beta Corp',
        role: 'Intern',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [{ id: 'b3', text: 'Assisted with support tickets', provenance: { type: 'MANUAL' } }],
      },
    ],
    projects: [
      {
        id: 'proj-1',
        name: 'Side Project',
        role: null,
        url: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [{ id: 'b4', text: 'Built a Python tool', provenance: { type: 'MANUAL' } }],
      },
    ],
    skills: [
      { id: 'skill-1', label: 'Languages', items: ['Python'] },
      { id: 'skill-2', label: 'Frameworks', items: ['React'] },
    ],
  };
}

const ALLOWLISTS: ResumeTailoringAllowlists = {
  factIds: new Set(['fact-1', 'fact-2']),
  factTextById: new Map([
    ['fact-1', 'Increased referral conversion by 70% through a new workflow'],
    ['fact-2', 'Built internal tools using PostgreSQL'],
  ]),
  requirementIds: new Set(['req-1', 'req-2']),
  researchFindingIds: new Set(['finding-1']),
};

function plan(operations: ResumeTailoringOperation[]) {
  return { operations };
}

describe('validateResumeTailoringPlan', () => {
  it('accepts a valid plan with no conflicts', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Increased referral conversion by 70% through a new workflow',
          sourceFactIds: ['fact-1'],
          requirementIds: ['req-1'],
          researchFindingIds: [],
          reason: 'Better matches the job requirement',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects an unknown bullet id', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'OMIT_BULLET',
          bulletId: 'does-not-exist',
          researchFindingIds: [],
          reason: 'Low relevance',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_bullet_id' });
  });

  it('rejects an unknown entry id', () => {
    const result = validateResumeTailoringPlan(
      plan([{ type: 'OMIT_ENTRY', entryId: 'does-not-exist', researchFindingIds: [], reason: 'Low relevance' }]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_entry_id' });
  });

  it('rejects an unknown fact id cited by REWRITE_BULLET', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Improved the referral workflow',
          sourceFactIds: ['not-a-real-fact'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_fact_id' });
  });

  it("rejects a fact id belonging to another user's request (not offered in this allowlist)", () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'Used PostgreSQL for internal tools',
          sourceFactIds: ['fact-2', 'someone-elses-fact-id'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_fact_id' });
  });

  it('rejects an unknown requirement id', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Improved the referral workflow',
          sourceFactIds: [],
          requirementIds: ['fake-requirement'],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_requirement_id' });
  });

  it('rejects two REWRITE_BULLET operations targeting the same bullet', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'A', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
        { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'B', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects REWRITE_BULLET + OMIT_BULLET on the same bullet', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'A', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
        { type: 'OMIT_BULLET', bulletId: 'b1', researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects OMIT_ENTRY + MOVE_ENTRY on the same entry', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'OMIT_ENTRY', entryId: 'exp-1', researchFindingIds: [], reason: 'x' },
        { type: 'MOVE_ENTRY', entryId: 'exp-1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects ADD_BULLET targeting an entry that is also being omitted', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'OMIT_ENTRY', entryId: 'exp-1', researchFindingIds: [], reason: 'x' },
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'New bullet',
          sourceFactIds: ['fact-1'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects REWRITE_BULLET on a bullet whose parent entry is being omitted', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'OMIT_ENTRY', entryId: 'exp-1', researchFindingIds: [], reason: 'x' },
        { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'A', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('rejects two MOVE_ENTRY operations targeting the same entry', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'MOVE_ENTRY', entryId: 'exp-1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
        { type: 'MOVE_ENTRY', entryId: 'exp-1', targetIndex: 1, researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });

  it('allows multiple ADD_BULLET operations targeting the same entry', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'First addition', sourceFactIds: ['fact-1'], requirementIds: [], researchFindingIds: [], reason: 'x' },
        { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'Second addition', sourceFactIds: ['fact-2'], requirementIds: [], researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects an out-of-range MOVE_BULLET targetIndex', () => {
    const result = validateResumeTailoringPlan(
      plan([{ type: 'MOVE_BULLET', bulletId: 'b1', targetIndex: 5, researchFindingIds: [], reason: 'x' }]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_target_index' });
  });

  it('accounts for this plan\'s own omits when validating a MOVE_BULLET targetIndex', () => {
    // exp-1 has 2 bullets (b1, b2); omitting b2 leaves exactly 1 valid index: 0.
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'OMIT_BULLET', bulletId: 'b2', researchFindingIds: [], reason: 'x' },
        { type: 'MOVE_BULLET', bulletId: 'b1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a REORDER_SKILLS with a duplicate id', () => {
    const result = validateResumeTailoringPlan(
      plan([{ type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-1', 'skill-1'], researchFindingIds: [], reason: 'x' }]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_skill_reorder' });
  });

  it('rejects a REORDER_SKILLS missing an existing skill group', () => {
    const result = validateResumeTailoringPlan(
      plan([{ type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-1'], researchFindingIds: [], reason: 'x' }]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_skill_reorder' });
  });

  it('accepts a REORDER_SKILLS that is a full permutation of existing skill groups', () => {
    const result = validateResumeTailoringPlan(
      plan([{ type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-2', 'skill-1'], researchFindingIds: [], reason: 'x' }]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a rewrite introducing an unsupported number', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built the referral workflow, improving conversion by 70%',
          sourceFactIds: [],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_number' });
  });

  it('accepts a rewrite introducing a number that is present in a cited fact', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built the referral workflow, improving conversion by 70%',
          sourceFactIds: ['fact-1'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a rewrite introducing an unsupported named technology', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built the referral workflow using Snowflake',
          sourceFactIds: [],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_technology' });
  });

  it('rejects ADD_BULLET introducing an unsupported named technology even though the "job" wants it (job text is never evidence)', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'Used Snowflake for data warehousing',
          sourceFactIds: ['fact-2'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_technology' });
  });

  it('accepts ADD_BULLET whose technology is grounded in its cited fact', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'Built internal tools using PostgreSQL',
          sourceFactIds: ['fact-2'],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects OMIT/MOVE conflicts even amid several otherwise-valid operations', () => {
    const result = validateResumeTailoringPlan(
      plan([
        { type: 'REWRITE_BULLET', bulletId: 'b3', proposedText: 'Resolved support tickets', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
        { type: 'MOVE_ENTRY', entryId: 'proj-1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
        { type: 'OMIT_ENTRY', entryId: 'exp-1', researchFindingIds: [], reason: 'x' },
        { type: 'MOVE_BULLET', bulletId: 'b1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'operation_conflict' });
  });
});

describe('validateResumeTailoringPlan — Phase 7H researchFindingIds', () => {
  it('accepts an operation citing a research finding id that was actually offered', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'MOVE_BULLET',
          bulletId: 'b1',
          targetIndex: 0,
          researchFindingIds: ['finding-1'],
          reason: 'Company research suggests this is now more relevant',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a researchFindingIds citation that was not offered in this request', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'OMIT_BULLET',
          bulletId: 'b2',
          researchFindingIds: ['finding-from-another-snapshot'],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_research_finding_id' });
  });

  it('rejects a researchFindingIds citation when no research was offered at all (empty allowlist)', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'OMIT_ENTRY',
          entryId: 'exp-1',
          researchFindingIds: ['finding-1'],
          reason: 'x',
        },
      ]),
      baseResume(),
      { ...ALLOWLISTS, researchFindingIds: new Set() },
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'unknown_research_finding_id' });
  });

  it('CRITICAL: citing a research finding never grounds a technology claim not present in cited facts/the original bullet', () => {
    // "finding-1" is a valid, offered research finding — but ALLOWLISTS.factTextById has no
    // Snowflake evidence anywhere, and the finding's own (untrusted) claim text is never added to
    // evidenceTexts. Citing it must not launder an otherwise-ungrounded technology claim.
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built the referral workflow using Snowflake',
          sourceFactIds: [],
          requirementIds: [],
          researchFindingIds: ['finding-1'],
          reason: 'Aligning with the company\'s current data platform focus',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_technology' });
  });

  it('CRITICAL: citing a research finding never grounds a numeric claim not present in cited facts/the original bullet', () => {
    const result = validateResumeTailoringPlan(
      plan([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Contributed to a $10B company initiative',
          sourceFactIds: [],
          requirementIds: [],
          researchFindingIds: ['finding-1'],
          reason: 'x',
        },
      ]),
      baseResume(),
      ALLOWLISTS,
    );
    expect(result).toMatchObject({ status: 'rejected', reason: 'ungrounded_number' });
  });
});
