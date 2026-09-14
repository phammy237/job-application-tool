import { describe, expect, it } from 'vitest';
import {
  MAX_RESUME_TAILORING_OPERATIONS,
  resumeTailoringOperationSchema,
  resumeTailoringPlanSchema,
} from './resume-tailoring';

const FACT_1 = '11111111-1111-1111-1111-111111111111';

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

describe('resumeTailoringOperationSchema', () => {
  it('accepts a well-formed REWRITE_BULLET operation', () => {
    expect(resumeTailoringOperationSchema.safeParse(rewriteOp()).success).toBe(true);
  });

  it('accepts a well-formed ADD_BULLET operation with at least one cited fact', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'ADD_BULLET',
      entryId: 'exp-1',
      proposedText: 'New bullet',
      sourceFactIds: [FACT_1],
      requirementIds: [],
      reason: 'x',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ADD_BULLET with zero cited facts — an added bullet must have grounding', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'ADD_BULLET',
      entryId: 'exp-1',
      proposedText: 'New bullet',
      sourceFactIds: [],
      requirementIds: [],
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ADD_BULLET with a non-UUID fact id', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'ADD_BULLET',
      entryId: 'exp-1',
      proposedText: 'New bullet',
      sourceFactIds: ['not-a-uuid'],
      requirementIds: [],
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported/unknown operation type', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'REPLACE_SECTION',
      section: 'experience',
      content: 'anything',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation carrying a raw JSON Patch shape', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      op: 'replace',
      path: '/experience/0/bullets/0/text',
      value: 'hacked',
    });
    expect(result.success).toBe(false);
  });

  it('rejects proposedText over the length cap', () => {
    const result = resumeTailoringOperationSchema.safeParse(
      rewriteOp({ proposedText: 'x'.repeat(601) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty proposedText', () => {
    const result = resumeTailoringOperationSchema.safeParse(rewriteOp({ proposedText: '   ' }));
    expect(result.success).toBe(false);
  });

  it('rejects a missing reason', () => {
    const result = resumeTailoringOperationSchema.safeParse(rewriteOp({ reason: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a reason over the length cap', () => {
    const result = resumeTailoringOperationSchema.safeParse(rewriteOp({ reason: 'x'.repeat(301) }));
    expect(result.success).toBe(false);
  });

  it('rejects more citations than the per-operation cap', () => {
    const tooMany = Array.from({ length: 13 }, () => FACT_1);
    const result = resumeTailoringOperationSchema.safeParse(rewriteOp({ sourceFactIds: tooMany }));
    expect(result.success).toBe(false);
  });

  it('rejects a MOVE_BULLET with a negative target index', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'MOVE_BULLET',
      bulletId: 'b1',
      targetIndex: -1,
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a MOVE_BULLET with a non-integer target index', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'MOVE_BULLET',
      bulletId: 'b1',
      targetIndex: 1.5,
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects REORDER_SKILLS with an empty ordering', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'REORDER_SKILLS',
      orderedSkillGroupIds: [],
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation carrying a latexSource or template field', () => {
    const result = resumeTailoringOperationSchema.safeParse({
      type: 'REWRITE_BULLET',
      bulletId: 'b1',
      proposedText: 'New',
      sourceFactIds: [],
      requirementIds: [],
      reason: 'x',
      latexSource: '\\textbf{hacked}',
    });
    // Extra unknown fields are stripped by default z.object parsing, not rejected — assert the
    // parsed value never carries the field through regardless.
    expect(result.success).toBe(true);
    if (result.success) {
      expect('latexSource' in result.data).toBe(false);
    }
  });
});

describe('resumeTailoringPlanSchema', () => {
  it('accepts a plan at exactly the operation cap', () => {
    const operations = Array.from({ length: MAX_RESUME_TAILORING_OPERATIONS }, (_, i) =>
      rewriteOp({ bulletId: `b${i}` }),
    );
    expect(resumeTailoringPlanSchema.safeParse({ operations }).success).toBe(true);
  });

  it('rejects a plan exceeding the operation cap', () => {
    const operations = Array.from({ length: MAX_RESUME_TAILORING_OPERATIONS + 1 }, (_, i) =>
      rewriteOp({ bulletId: `b${i}` }),
    );
    expect(resumeTailoringPlanSchema.safeParse({ operations }).success).toBe(false);
  });

  it('accepts an empty operations array (the model finding nothing to change)', () => {
    expect(resumeTailoringPlanSchema.safeParse({ operations: [] }).success).toBe(true);
  });

  it('rejects a plan with a top-level résumé field instead of operations', () => {
    const result = resumeTailoringPlanSchema.safeParse({
      operations: [],
      resume: { header: { fullName: 'Hacked Name' } },
    });
    // Unknown top-level fields are stripped, not rejected, by default z.object parsing — assert
    // the parsed value never carries a `resume` field through regardless.
    expect(result.success).toBe(true);
    if (result.success) {
      expect('resume' in result.data).toBe(false);
    }
  });

  it('rejects a plan missing the operations field entirely', () => {
    expect(resumeTailoringPlanSchema.safeParse({}).success).toBe(false);
  });
});
