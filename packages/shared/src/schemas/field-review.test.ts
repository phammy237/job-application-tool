import { describe, expect, it } from 'vitest';
import {
  classifyInitialReviewState,
  isDecidable,
  READY_CONFIDENCE_THRESHOLD,
  reviewStateForSuggestion,
} from './field-review';
import type { GeneratedAnswer } from './generated-answer';

function answer(overrides: Partial<GeneratedAnswer> = {}): GeneratedAnswer {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    applicationId: null,
    jobId: '33333333-3333-4333-8333-333333333333',
    fieldLabel: 'Field',
    fieldClassification: 'FREE_RESPONSE',
    answer: 'Draft text',
    confidence: 0.8,
    sourceFactIds: [],
    reasoningSummary: null,
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

describe('classifyInitialReviewState', () => {
  it('classifies DEMOGRAPHIC/LEGAL/AUTHENTICATION as SENSITIVE regardless of current value', () => {
    for (const classification of ['DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION'] as const) {
      expect(
        classifyInitialReviewState({ classification, currentValue: null }),
      ).toBe('SENSITIVE');
      expect(
        classifyInitialReviewState({ classification, currentValue: 'already answered' }),
      ).toBe('SENSITIVE');
    }
  });

  it('classifies FILE_UPLOAD and UNKNOWN as UNSUPPORTED', () => {
    expect(
      classifyInitialReviewState({ classification: 'FILE_UPLOAD', currentValue: null }),
    ).toBe('UNSUPPORTED');
    expect(classifyInitialReviewState({ classification: 'UNKNOWN', currentValue: null })).toBe(
      'UNSUPPORTED',
    );
  });

  it('classifies a non-sensitive field with a non-empty current value as ALREADY_COMPLETED', () => {
    expect(
      classifyInitialReviewState({ classification: 'BASIC_PROFILE', currentValue: 'Jane Doe' }),
    ).toBe('ALREADY_COMPLETED');
  });

  it('SENSITIVE and UNSUPPORTED take priority over an existing current value', () => {
    expect(
      classifyInitialReviewState({ classification: 'FILE_UPLOAD', currentValue: 'resume.pdf' }),
    ).toBe('UNSUPPORTED');
  });

  it('classifies an empty, eligible field as PENDING_SUGGESTION', () => {
    expect(
      classifyInitialReviewState({ classification: 'EXPERIENCE', currentValue: null }),
    ).toBe('PENDING_SUGGESTION');
  });
});

describe('reviewStateForSuggestion', () => {
  it('returns NEEDS_INPUT for a null suggestion', () => {
    expect(reviewStateForSuggestion(null)).toBe('NEEDS_INPUT');
  });

  it('returns READY at or above the confidence threshold', () => {
    expect(reviewStateForSuggestion(answer({ confidence: READY_CONFIDENCE_THRESHOLD }))).toBe(
      'READY',
    );
    expect(reviewStateForSuggestion(answer({ confidence: 0.99 }))).toBe('READY');
  });

  it('returns SUGGESTED below the confidence threshold', () => {
    expect(
      reviewStateForSuggestion(answer({ confidence: READY_CONFIDENCE_THRESHOLD - 0.01 })),
    ).toBe('SUGGESTED');
    expect(reviewStateForSuggestion(answer({ confidence: 0 }))).toBe('SUGGESTED');
  });
});

describe('isDecidable', () => {
  it('is true only for READY and SUGGESTED', () => {
    expect(isDecidable('READY')).toBe(true);
    expect(isDecidable('SUGGESTED')).toBe(true);
    expect(isDecidable('SENSITIVE')).toBe(false);
    expect(isDecidable('UNSUPPORTED')).toBe(false);
    expect(isDecidable('ALREADY_COMPLETED')).toBe(false);
    expect(isDecidable('PENDING_SUGGESTION')).toBe(false);
    expect(isDecidable('NEEDS_INPUT')).toBe(false);
  });
});
