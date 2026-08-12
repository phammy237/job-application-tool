import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { DetectedField } from '@career-os/shared';
import { requestSuggestion, type SuggestionOutcome } from '../../lib/api-client';
import { getStoredReview, setStoredReview } from '../../lib/review-storage';
import { initialReviewState, reviewReducer } from '../state/review-reducer';

function resolveFieldLabel(field: DetectedField): string {
  return field.label ?? field.htmlName ?? field.htmlId ?? 'Untitled field';
}

/**
 * Drives the popup's Phase 4A review flow: hydrates prior approve/edit/skip decisions for this
 * job from chrome.storage.local (or classifies fresh if this is a new/changed field set),
 * requests suggestions one field at a time from POST /api/jobs/:id/suggestions, and exposes the
 * approve/edit/skip/approve-all actions the review UI calls. See review-reducer.ts for the
 * actual state transitions — this hook is thin wiring (fetch + storage + dispatch) on top of it.
 */
export function useFieldReview(jobId: string | null, fields: DetectedField[]) {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const hydratedJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    hydratedJobIdRef.current = null;

    // HYDRATE reconciles field by field against a live fingerprint (review-reducer.ts) — every
    // stored entry is a candidate, never trusted outright, so a stale/rescanned page can never
    // silently inherit a decision that was actually made about a different field.
    void getStoredReview(jobId).then((stored) => {
      if (cancelled) return;
      dispatch({ type: 'HYDRATE', stored, freshFields: fields });
      hydratedJobIdRef.current = jobId;
    });

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on jobId alone. `fields` gets a new array identity on every re-analysis
    // of the same job, which would otherwise re-run this effect and wipe out in-progress review
    // decisions on every render — the fields it closes over are read once, at effect-run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    // Skip persisting the transient empty state that exists before hydration/INIT resolves —
    // otherwise a fast unmount could overwrite real stored decisions with {}.
    if (!jobId || hydratedJobIdRef.current !== jobId) return;
    void setStoredReview(jobId, state.byId);
  }, [jobId, state.byId]);

  const requestSuggestionFor = useCallback(
    async (fieldId: string): Promise<SuggestionOutcome['status'] | undefined> => {
      const reviewableField = state.byId[fieldId];
      if (!jobId || !reviewableField) return undefined;

      dispatch({ type: 'SUGGESTION_REQUESTED', fieldId });
      const outcome = await requestSuggestion(
        jobId,
        resolveFieldLabel(reviewableField.detected),
        reviewableField.detected.classification,
      );

      switch (outcome.status) {
        case 'generated':
          dispatch({ type: 'SUGGESTION_SUCCEEDED', fieldId, suggestion: outcome.suggestion });
          break;
        case 'not_supported_for_field':
        case 'insufficient_facts':
        case 'no_suggestion':
          dispatch({ type: 'SUGGESTION_SUCCEEDED', fieldId, suggestion: null });
          break;
        case 'rate_limited':
          dispatch({
            type: 'SUGGESTION_FAILED',
            fieldId,
            message: 'AI request limit reached for this period.',
          });
          break;
        case 'job_not_found':
          dispatch({
            type: 'SUGGESTION_FAILED',
            fieldId,
            message: 'This job could not be found — try re-analyzing the page.',
          });
          break;
        case 'provider_error':
          dispatch({ type: 'SUGGESTION_FAILED', fieldId, message: outcome.message });
          break;
      }
      return outcome.status;
    },
    [jobId, state.byId],
  );

  const requestSuggestionsForAllEligible = useCallback(async () => {
    const eligibleFieldIds = Object.values(state.byId)
      .filter((field) => field.reviewState === 'PENDING_SUGGESTION')
      .map((field) => field.detected.fieldId);

    // Sequential, not Promise.all — each call spends one of the user's rate-limited AI requests
    // (packages/database's increment_ai_request_usage), so firing every eligible field at once
    // would burn through the whole limit on one page before the user has seen a single result.
    // Stops immediately once the limit is hit rather than continuing to fail the rest one by one.
    for (const fieldId of eligibleFieldIds) {
      const status = await requestSuggestionFor(fieldId);
      if (status === 'rate_limited') break;
    }
  }, [state.byId, requestSuggestionFor]);

  const approve = useCallback((fieldId: string) => dispatch({ type: 'APPROVE', fieldId }), []);
  const skip = useCallback((fieldId: string) => dispatch({ type: 'SKIP', fieldId }), []);
  const edit = useCallback(
    (fieldId: string, text: string) => dispatch({ type: 'EDIT', fieldId, text }),
    [],
  );
  const resetDecision = useCallback(
    (fieldId: string) => dispatch({ type: 'RESET_DECISION', fieldId }),
    [],
  );
  const approveAllEligible = useCallback(() => dispatch({ type: 'APPROVE_ALL_ELIGIBLE' }), []);

  return {
    fields: state.byId,
    loadingIds: state.loadingIds,
    requestSuggestionFor,
    requestSuggestionsForAllEligible,
    approve,
    skip,
    edit,
    resetDecision,
    approveAllEligible,
  };
}
