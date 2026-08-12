import type { DetectedField, GeneratedAnswer, ReviewableField } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { fingerprintField } from '../../lib/field-fingerprint';
import type { PersistedReview } from '../../lib/review-storage';
import { initialReviewState, reviewReducer, type ReviewState } from './review-reducer';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
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
    availableFactIds: ['44444444-4444-4444-8444-444444444444'],
    generationRunId: null,
    attemptNumber: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** noUncheckedIndexedAccess makes state.byId[id] read as `ReviewableField | undefined` — this
 * throws with a clear message instead of scattering non-null assertions through every test. */
function getField(state: ReviewState, fieldId: string): ReviewableField {
  const found = state.byId[fieldId];
  if (!found) throw new Error(`Expected field "${fieldId}" to exist in review state.`);
  return found;
}

describe('reviewReducer INIT', () => {
  it('classifies each field into its initial review state', () => {
    const state = reviewReducer(initialReviewState, {
      type: 'INIT',
      fields: [
        field({ fieldId: 'a', classification: 'DEMOGRAPHIC' }),
        field({ fieldId: 'b', classification: 'FILE_UPLOAD' }),
        field({ fieldId: 'c', currentValue: 'Jane Doe' }),
        field({ fieldId: 'd', classification: 'EXPERIENCE' }),
      ],
    });

    expect(getField(state, 'a').reviewState).toBe('SENSITIVE');
    expect(getField(state, 'b').reviewState).toBe('UNSUPPORTED');
    expect(getField(state, 'c').reviewState).toBe('ALREADY_COMPLETED');
    expect(getField(state, 'd').reviewState).toBe('PENDING_SUGGESTION');
    expect(Object.values(state.byId).every((f) => f.approvalState === 'PENDING')).toBe(true);
  });
});

describe('reviewReducer suggestion lifecycle', () => {
  function stateWithOneField(): ReviewState {
    return reviewReducer(initialReviewState, {
      type: 'INIT',
      fields: [field({ fieldId: 'a', classification: 'EXPERIENCE' })],
    });
  }

  it('marks a field loading on SUGGESTION_REQUESTED', () => {
    const state = reviewReducer(stateWithOneField(), {
      type: 'SUGGESTION_REQUESTED',
      fieldId: 'a',
    });
    expect(state.loadingIds.a).toBe(true);
  });

  it('promotes to READY when the suggestion confidence is high', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, { type: 'SUGGESTION_REQUESTED', fieldId: 'a' });
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ confidence: 0.95 }),
    });
    expect(getField(state, 'a').reviewState).toBe('READY');
    expect(getField(state, 'a').suggestion?.answer).toBe('Jane Doe');
    expect(state.loadingIds.a).toBeUndefined();
  });

  it('demotes to SUGGESTED when the suggestion confidence is below the threshold', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ confidence: 0.5 }),
    });
    expect(getField(state, 'a').reviewState).toBe('SUGGESTED');
  });

  it('moves to NEEDS_INPUT when the suggestion is null', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, { type: 'SUGGESTION_SUCCEEDED', fieldId: 'a', suggestion: null });
    expect(getField(state, 'a').reviewState).toBe('NEEDS_INPUT');
  });

  it('records an error message and clears loading on SUGGESTION_FAILED', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, { type: 'SUGGESTION_REQUESTED', fieldId: 'a' });
    state = reviewReducer(state, {
      type: 'SUGGESTION_FAILED',
      fieldId: 'a',
      message: 'AI provider error',
    });
    expect(getField(state, 'a').errorMessage).toBe('AI provider error');
    expect(state.loadingIds.a).toBeUndefined();
  });

  it('resets an existing approval decision back to PENDING when a fresh suggestion replaces the old one — a re-fetched suggestion must never inherit a decision made about different content', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ answer: 'First draft', confidence: 0.95 }),
    });
    state = reviewReducer(state, { type: 'APPROVE', fieldId: 'a' });
    expect(getField(state, 'a').approvalState).toBe('APPROVED');

    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ answer: 'Completely different second draft', confidence: 0.5 }),
    });
    expect(getField(state, 'a').approvalState).toBe('PENDING');
    expect(getField(state, 'a').editedText).toBeNull();
    expect(getField(state, 'a').suggestion?.answer).toBe('Completely different second draft');
  });

  it('clears a stale editedText when a fresh suggestion replaces an edited one', () => {
    let state = stateWithOneField();
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ confidence: 0.95 }),
    });
    state = reviewReducer(state, { type: 'EDIT', fieldId: 'a', text: 'My own wording' });
    expect(getField(state, 'a').editedText).toBe('My own wording');

    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'a',
      suggestion: answer({ confidence: 0.95 }),
    });
    expect(getField(state, 'a').approvalState).toBe('PENDING');
    expect(getField(state, 'a').editedText).toBeNull();
  });
});

describe('reviewReducer approve/edit/skip enforcement', () => {
  function readyState(): ReviewState {
    let state = reviewReducer(initialReviewState, {
      type: 'INIT',
      fields: [
        field({ fieldId: 'ready', classification: 'EXPERIENCE' }),
        field({ fieldId: 'sensitive', classification: 'DEMOGRAPHIC' }),
      ],
    });
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'ready',
      suggestion: answer({ confidence: 0.95 }),
    });
    return state;
  }

  it('approves a READY field', () => {
    const state = reviewReducer(readyState(), { type: 'APPROVE', fieldId: 'ready' });
    expect(getField(state, 'ready').approvalState).toBe('APPROVED');
  });

  it('does nothing when approving a SENSITIVE field — no suggestion exists to approve', () => {
    const before = readyState();
    const after = reviewReducer(before, { type: 'APPROVE', fieldId: 'sensitive' });
    expect(getField(after, 'sensitive').approvalState).toBe('PENDING');
    expect(after).toEqual(before);
  });

  it('edits a decidable field, storing the replacement text', () => {
    const state = reviewReducer(readyState(), {
      type: 'EDIT',
      fieldId: 'ready',
      text: 'Jane A. Doe',
    });
    expect(getField(state, 'ready').approvalState).toBe('EDITED');
    expect(getField(state, 'ready').editedText).toBe('Jane A. Doe');
  });

  it('skips a decidable field', () => {
    const state = reviewReducer(readyState(), { type: 'SKIP', fieldId: 'ready' });
    expect(getField(state, 'ready').approvalState).toBe('SKIPPED');
  });

  it('resets a decision back to PENDING and clears editedText', () => {
    let state = reviewReducer(readyState(), { type: 'EDIT', fieldId: 'ready', text: 'x' });
    state = reviewReducer(state, { type: 'RESET_DECISION', fieldId: 'ready' });
    expect(getField(state, 'ready').approvalState).toBe('PENDING');
    expect(getField(state, 'ready').editedText).toBeNull();
  });

  it('ignores an approve/edit/skip for an unknown fieldId', () => {
    const before = readyState();
    const after = reviewReducer(before, { type: 'APPROVE', fieldId: 'does-not-exist' });
    expect(after).toEqual(before);
  });
});

describe('reviewReducer APPROVE_ALL_ELIGIBLE', () => {
  it('bulk-approves only PENDING READY fields, leaving SUGGESTED and prior decisions untouched', () => {
    let state = reviewReducer(initialReviewState, {
      type: 'INIT',
      fields: [
        field({ fieldId: 'ready-1', classification: 'EXPERIENCE' }),
        field({ fieldId: 'ready-2-already-skipped', classification: 'EXPERIENCE' }),
        field({ fieldId: 'suggested', classification: 'FREE_RESPONSE' }),
      ],
    });
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'ready-1',
      suggestion: answer({ confidence: 0.95 }),
    });
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'ready-2-already-skipped',
      suggestion: answer({ confidence: 0.95 }),
    });
    state = reviewReducer(state, { type: 'SKIP', fieldId: 'ready-2-already-skipped' });
    state = reviewReducer(state, {
      type: 'SUGGESTION_SUCCEEDED',
      fieldId: 'suggested',
      suggestion: answer({ confidence: 0.5 }),
    });

    state = reviewReducer(state, { type: 'APPROVE_ALL_ELIGIBLE' });

    expect(getField(state, 'ready-1').approvalState).toBe('APPROVED');
    // Already decided (skipped) before the bulk approve — must not be overwritten.
    expect(getField(state, 'ready-2-already-skipped').approvalState).toBe('SKIPPED');
    // SUGGESTED (below-threshold) is never bulk-approved, even though it has a suggestion.
    expect(getField(state, 'suggested').approvalState).toBe('PENDING');
  });

  it('never approves a PENDING_SUGGESTION field — a field with no proposed answer at all must stay PENDING regardless of "approve all"', () => {
    const state = reviewReducer(
      reviewReducer(initialReviewState, {
        type: 'INIT',
        fields: [field({ fieldId: 'not-yet-suggested', classification: 'EXPERIENCE' })],
      }),
      { type: 'APPROVE_ALL_ELIGIBLE' },
    );
    expect(getField(state, 'not-yet-suggested').reviewState).toBe('PENDING_SUGGESTION');
    expect(getField(state, 'not-yet-suggested').approvalState).toBe('PENDING');
  });

  it('defense in depth: refuses to approve a malformed READY field with no suggestion attached, even though this should be unreachable through normal reducer transitions', () => {
    let state = reviewReducer(initialReviewState, {
      type: 'INIT',
      fields: [field({ fieldId: 'malformed', classification: 'EXPERIENCE' })],
    });
    // Simulate a hypothetical future bug that sets reviewState to READY without a suggestion —
    // not reachable via any real action today, but the guard must hold regardless.
    state = {
      ...state,
      byId: { ...state.byId, malformed: { ...getField(state, 'malformed'), reviewState: 'READY' } },
    };

    const approved = reviewReducer(state, { type: 'APPROVE', fieldId: 'malformed' });
    expect(getField(approved, 'malformed').approvalState).toBe('PENDING');

    const bulkApproved = reviewReducer(state, { type: 'APPROVE_ALL_ELIGIBLE' });
    expect(getField(bulkApproved, 'malformed').approvalState).toBe('PENDING');
  });
});

describe('reviewReducer HYDRATE', () => {
  function persistedEntry(overrides: Partial<PersistedReview[string]> = {}): PersistedReview[string] {
    return {
      fingerprint: fingerprintField(field({ fieldId: 'a' })),
      reviewState: 'READY',
      approvalState: 'APPROVED',
      suggestion: answer({ confidence: 0.95 }),
      editedText: null,
      ...overrides,
    };
  }

  it('restores a stored decision when the fingerprint still matches the fresh field', () => {
    const stored: PersistedReview = { a: persistedEntry() };
    const state = reviewReducer(initialReviewState, {
      type: 'HYDRATE',
      stored,
      freshFields: [field({ fieldId: 'a' })],
    });
    expect(getField(state, 'a').approvalState).toBe('APPROVED');
    expect(getField(state, 'a').reviewState).toBe('READY');
    expect(state.loadingIds).toEqual({});
  });

  it('discards a stored decision and reclassifies fresh when the field label changed since it was stored', () => {
    const stored: PersistedReview = { a: persistedEntry() };
    const state = reviewReducer(initialReviewState, {
      type: 'HYDRATE',
      stored,
      freshFields: [field({ fieldId: 'a', label: 'A completely different question' })],
    });
    expect(getField(state, 'a').approvalState).toBe('PENDING');
    expect(getField(state, 'a').suggestion).toBeNull();
  });

  it('discards a stored decision when the classification changed since it was stored — the real regression this guards against: index-based fieldIds are meaningless across a changed page', () => {
    const stored: PersistedReview = {
      'field-2': persistedEntry({
        fingerprint: fingerprintField(field({ fieldId: 'field-2', classification: 'BASIC_PROFILE' })),
      }),
    };
    const state = reviewReducer(initialReviewState, {
      type: 'HYDRATE',
      stored,
      freshFields: [field({ fieldId: 'field-2', classification: 'COMPENSATION', label: 'Desired salary' })],
    });
    expect(getField(state, 'field-2').approvalState).toBe('PENDING');
    expect(getField(state, 'field-2').reviewState).toBe('PENDING_SUGGESTION');
  });

  it('discards a stored decision when the current value changed since it was stored (e.g. the user answered it manually in between)', () => {
    const stored: PersistedReview = {
      a: persistedEntry({ fingerprint: fingerprintField(field({ fieldId: 'a', currentValue: null })) }),
    };
    const state = reviewReducer(initialReviewState, {
      type: 'HYDRATE',
      stored,
      freshFields: [field({ fieldId: 'a', currentValue: 'Now filled in by hand' })],
    });
    expect(getField(state, 'a').approvalState).toBe('PENDING');
  });

  it('classifies a field with no stored entry fresh, same as INIT', () => {
    const state = reviewReducer(initialReviewState, {
      type: 'HYDRATE',
      stored: null,
      freshFields: [field({ fieldId: 'a', classification: 'DEMOGRAPHIC' })],
    });
    expect(getField(state, 'a').reviewState).toBe('SENSITIVE');
  });
});
