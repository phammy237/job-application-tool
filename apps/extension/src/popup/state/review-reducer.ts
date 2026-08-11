import {
  classifyInitialReviewState,
  isDecidable,
  reviewStateForSuggestion,
  type DetectedField,
  type GeneratedAnswer,
  type ReviewableField,
} from '@career-os/shared';

export interface ReviewState {
  byId: Record<string, ReviewableField>;
  /** Fields with an in-flight suggestion request — kept separate from ReviewableField.reviewState
   * on purpose: "loading" is ephemeral UI/request state, not part of the persisted review model
   * (packages/shared's field-review schema), so it never gets written to chrome.storage.local. */
  loadingIds: Record<string, boolean>;
}

export type ReviewAction =
  | { type: 'INIT'; fields: DetectedField[] }
  | { type: 'HYDRATE'; review: Record<string, ReviewableField> }
  | { type: 'SUGGESTION_REQUESTED'; fieldId: string }
  | { type: 'SUGGESTION_SUCCEEDED'; fieldId: string; suggestion: GeneratedAnswer | null }
  | { type: 'SUGGESTION_FAILED'; fieldId: string; message: string }
  | { type: 'APPROVE'; fieldId: string }
  | { type: 'SKIP'; fieldId: string }
  | { type: 'EDIT'; fieldId: string; text: string }
  | { type: 'RESET_DECISION'; fieldId: string }
  | { type: 'APPROVE_ALL_ELIGIBLE' };

export const initialReviewState: ReviewState = { byId: {}, loadingIds: {} };

function buildReviewableField(field: DetectedField): ReviewableField {
  return {
    detected: field,
    reviewState: classifyInitialReviewState(field),
    approvalState: 'PENDING',
    suggestion: null,
    editedText: null,
    errorMessage: null,
  };
}

function setField(
  byId: Record<string, ReviewableField>,
  fieldId: string,
  update: (field: ReviewableField) => ReviewableField,
): Record<string, ReviewableField> {
  const existing = byId[fieldId];
  if (!existing) return byId;
  return { ...byId, [fieldId]: update(existing) };
}

/**
 * Same as setField but a no-op unless the field is currently in a decidable review state
 * (READY/SUGGESTED). This is the reducer-level enforcement of CLAUDE.md's "there is structurally
 * no suggestion to approve" rule extended to every non-decidable state (SENSITIVE/UNSUPPORTED/
 * ALREADY_COMPLETED/PENDING_SUGGESTION/NEEDS_INPUT) — a stray approve/edit/skip dispatch from a
 * UI bug cannot corrupt state even if it fires, because the state transition itself refuses.
 */
function setDecidableField(
  byId: Record<string, ReviewableField>,
  fieldId: string,
  update: (field: ReviewableField) => ReviewableField,
): Record<string, ReviewableField> {
  const existing = byId[fieldId];
  if (!existing || !isDecidable(existing.reviewState)) return byId;
  return { ...byId, [fieldId]: update(existing) };
}

function withoutLoading(
  loadingIds: Record<string, boolean>,
  fieldId: string,
): Record<string, boolean> {
  const { [fieldId]: _removed, ...rest } = loadingIds;
  return rest;
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'INIT': {
      const byId: Record<string, ReviewableField> = {};
      for (const field of action.fields) {
        byId[field.fieldId] = buildReviewableField(field);
      }
      return { byId, loadingIds: {} };
    }

    case 'HYDRATE':
      return { byId: action.review, loadingIds: {} };

    case 'SUGGESTION_REQUESTED':
      return {
        loadingIds: { ...state.loadingIds, [action.fieldId]: true },
        byId: setField(state.byId, action.fieldId, (field) => ({ ...field, errorMessage: null })),
      };

    case 'SUGGESTION_SUCCEEDED':
      return {
        loadingIds: withoutLoading(state.loadingIds, action.fieldId),
        byId: setField(state.byId, action.fieldId, (field) => ({
          ...field,
          suggestion: action.suggestion,
          reviewState: reviewStateForSuggestion(action.suggestion),
          errorMessage: null,
        })),
      };

    case 'SUGGESTION_FAILED':
      return {
        loadingIds: withoutLoading(state.loadingIds, action.fieldId),
        byId: setField(state.byId, action.fieldId, (field) => ({
          ...field,
          errorMessage: action.message,
        })),
      };

    case 'APPROVE':
      return {
        ...state,
        byId: setDecidableField(state.byId, action.fieldId, (field) => ({
          ...field,
          approvalState: 'APPROVED',
        })),
      };

    case 'SKIP':
      return {
        ...state,
        byId: setDecidableField(state.byId, action.fieldId, (field) => ({
          ...field,
          approvalState: 'SKIPPED',
        })),
      };

    case 'EDIT':
      return {
        ...state,
        byId: setDecidableField(state.byId, action.fieldId, (field) => ({
          ...field,
          approvalState: 'EDITED',
          editedText: action.text,
        })),
      };

    case 'RESET_DECISION':
      return {
        ...state,
        byId: setDecidableField(state.byId, action.fieldId, (field) => ({
          ...field,
          approvalState: 'PENDING',
          editedText: null,
        })),
      };

    case 'APPROVE_ALL_ELIGIBLE': {
      const byId: Record<string, ReviewableField> = { ...state.byId };
      for (const [fieldId, field] of Object.entries(byId)) {
        if (field.reviewState === 'READY' && field.approvalState === 'PENDING') {
          byId[fieldId] = { ...field, approvalState: 'APPROVED' };
        }
      }
      return { ...state, byId };
    }

    default:
      return state;
  }
}
