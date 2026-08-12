import type { DetectedField, GeneratedAnswer, ReviewableField } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import type { FillResult } from '../../content-script/fill/fill-engine';
import { summarizeAutofillProgress } from './summarize-autofill';

function detected(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    fieldId: 'field-0',
    label: 'Full Name',
    htmlName: 'full_name',
    htmlId: 'full_name',
    inputType: 'text',
    classification: 'BASIC_PROFILE',
    confidence: 0.8,
    currentValue: null,
    ...overrides,
  };
}

function answer(overrides: Partial<GeneratedAnswer> = {}): GeneratedAnswer {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    applicationId: null,
    jobId: '33333333-3333-4333-8333-333333333333',
    fieldLabel: 'Full Name',
    fieldClassification: 'BASIC_PROFILE',
    answer: 'Jane Doe',
    confidence: 0.9,
    sourceFactIds: ['44444444-4444-4444-8444-444444444444'],
    reasoningSummary: 'From your profile.',
    unsupportedClaims: [],
    requiresUserReview: true,
    userDecision: null,
    finalText: null,
    insufficientData: false,
    rejectionReason: null,
    availableFactIds: null,
    generationRunId: null,
    attemptNumber: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function field(overrides: Partial<ReviewableField> = {}): ReviewableField {
  return {
    detected: detected(),
    reviewState: 'READY',
    approvalState: 'APPROVED',
    suggestion: answer(),
    editedText: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('summarizeAutofillProgress — structural states', () => {
  it('counts SENSITIVE and UNSUPPORTED fields as manual, with sanitized reasons and no value content', () => {
    const result = summarizeAutofillProgress(
      {
        a: field({
          reviewState: 'SENSITIVE',
          approvalState: 'PENDING',
          suggestion: null,
          detected: detected({ fieldId: 'a', classification: 'DEMOGRAPHIC', currentValue: 'secret answer' }),
        }),
        b: field({
          reviewState: 'UNSUPPORTED',
          approvalState: 'PENDING',
          suggestion: null,
          detected: detected({ fieldId: 'b', classification: 'FILE_UPLOAD' }),
        }),
      },
      [],
    );
    expect(result.autofillSummary.manual).toBe(2);
    expect(result.unresolvedFields).toHaveLength(2);
    expect(result.unresolvedFields.every((f) => f.status === 'SENSITIVE' || f.status === 'UNSUPPORTED')).toBe(true);
    expect(JSON.stringify(result.unresolvedFields)).not.toContain('secret answer');
  });

  it('does not list ALREADY_COMPLETED fields as unresolved', () => {
    const result = summarizeAutofillProgress(
      { a: field({ reviewState: 'ALREADY_COMPLETED', suggestion: null, approvalState: 'PENDING' }) },
      [],
    );
    expect(result.autofillSummary.unresolved).toBe(0);
    expect(result.autofillSummary.manual).toBe(0);
    expect(result.unresolvedFields).toHaveLength(0);
  });

  it('counts NEEDS_INPUT and never-requested PENDING_SUGGESTION fields as unresolved', () => {
    const result = summarizeAutofillProgress(
      {
        a: field({ reviewState: 'NEEDS_INPUT', suggestion: null, approvalState: 'PENDING' }),
        b: field({ reviewState: 'PENDING_SUGGESTION', suggestion: null, approvalState: 'PENDING' }),
      },
      [],
    );
    expect(result.autofillSummary.unresolved).toBe(2);
    expect(result.unresolvedFields.every((f) => f.status === 'NEEDS_INPUT')).toBe(true);
  });
});

describe('summarizeAutofillProgress — decided fields', () => {
  it('counts a SKIPPED field as skipped, not unresolved', () => {
    const result = summarizeAutofillProgress({ a: field({ approvalState: 'SKIPPED' }) }, []);
    expect(result.autofillSummary.skipped).toBe(1);
    expect(result.autofillSummary.unresolved).toBe(0);
    expect(result.answeredFields).toHaveLength(0);
  });

  it('counts a still-PENDING READY/SUGGESTED field as unresolved', () => {
    const result = summarizeAutofillProgress({ a: field({ approvalState: 'PENDING' }) }, []);
    expect(result.autofillSummary.unresolved).toBe(1);
    expect(result.autofillSummary.approved).toBe(0);
  });

  it('counts an APPROVED field with no fill attempt yet as approved + unresolved', () => {
    const result = summarizeAutofillProgress({ a: field({ approvalState: 'APPROVED' }) }, []);
    expect(result.autofillSummary.approved).toBe(1);
    expect(result.autofillSummary.unresolved).toBe(1);
    expect(result.autofillSummary.filled).toBe(0);
  });

  it('counts an APPROVED + successfully filled field as filled, not unresolved', () => {
    const fillResults: FillResult[] = [{ fieldId: 'field-0', status: 'success', reason: 'Filled.' }];
    const result = summarizeAutofillProgress({ a: field({ approvalState: 'APPROVED' }) }, fillResults);
    expect(result.autofillSummary.filled).toBe(1);
    expect(result.autofillSummary.unresolved).toBe(0);
  });

  it('counts an APPROVED + failed fill as failed, with a sanitized reason attached', () => {
    const fillResults: FillResult[] = [{ fieldId: 'field-0', status: 'failed', reason: 'This field is disabled.' }];
    const result = summarizeAutofillProgress({ a: field({ approvalState: 'APPROVED' }) }, fillResults);
    expect(result.autofillSummary.failed).toBe(1);
    expect(result.unresolvedFields[0]?.status).toBe('FILL_FAILED');
    expect(result.unresolvedFields[0]?.reason).toBe('This field is disabled.');
  });

  it('counts stale/requires_rescan/unsupported fill outcomes as unresolved, not failed', () => {
    for (const status of ['stale', 'requires_rescan', 'unsupported'] as const) {
      const fillResults: FillResult[] = [{ fieldId: 'field-0', status, reason: 'x' }];
      const result = summarizeAutofillProgress({ a: field({ approvalState: 'APPROVED' }) }, fillResults);
      expect(result.autofillSummary.unresolved).toBe(1);
      expect(result.autofillSummary.failed).toBe(0);
    }
  });
});

describe('summarizeAutofillProgress — answeredFields', () => {
  it('references the generated answer by id, distinguishing APPROVED from EDITED provenance', () => {
    const result = summarizeAutofillProgress(
      {
        a: field({
          detected: detected({ fieldId: 'a' }),
          approvalState: 'APPROVED',
          suggestion: answer({ id: 'answer-a' }),
        }),
        b: field({
          detected: detected({ fieldId: 'b' }),
          approvalState: 'EDITED',
          editedText: 'My own wording',
          suggestion: answer({ id: 'answer-b' }),
        }),
      },
      [],
    );

    expect(result.answeredFields).toEqual(
      expect.arrayContaining([
        { generatedAnswerId: 'answer-a', decision: 'APPROVED', finalText: null },
        { generatedAnswerId: 'answer-b', decision: 'EDITED', finalText: 'My own wording' },
      ]),
    );
  });

  it('never includes an answered field for a decided field with no suggestion attached', () => {
    const result = summarizeAutofillProgress(
      { a: field({ approvalState: 'APPROVED', suggestion: null }) },
      [],
    );
    expect(result.answeredFields).toHaveLength(0);
  });
});
