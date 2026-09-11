import { useCallback, useEffect, useState } from 'react';
import type {
  ApplicationStatus,
  ConsistencyFinding,
  ReviewableField,
} from '@career-os/shared';
import {
  checkConsistency,
  getTrackedApplication,
  markApplied,
  saveApplication,
} from '../../lib/api-client';
import type { FillResult } from '../../content-script/fill/fill-engine';
import { summarizeAutofillProgress } from '../lib/summarize-autofill';

export type TrackerStatus =
  | 'idle'
  | 'checking'
  | 'saving'
  | 'saved'
  | 'error'
  | 'checking-consistency'
  | 'reviewing-consistency'
  | 'marking-applied';

/**
 * Drives the popup's Phase 4C save/update/mark-applied flow, extended in Phase 5B.2 with the
 * consistency-review step. On mount (once a job has been analyzed), checks whether the job is
 * already tracked; `save()` computes the sanitized autofill summary from the current review/fill
 * state and upserts it; `startMarkAsApplied()`/`confirmMarkAsApplied()` are a fully separate flow
 * the UI must gate behind its own explicit confirmation — this hook never calls either on its
 * own, and `save()` never implies it (docs/IMPLEMENTATION_PLAN.md Phase 4C: "no fill, save,
 * navigation, or page event automatically marks the application applied").
 *
 * `checkConsistency` is advisory only — `reviewFindings` reflects what it returned, but the final
 * `markApplied` call re-verifies everything server-side; a rejected server response replaces
 * `reviewFindings` with whatever the server actually found, never trusting the earlier GET as
 * still current (docs/IMPLEMENTATION_PLAN.md Phase 5B.2F).
 */
export function useApplicationTracker(jobId: string | null) {
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<ApplicationStatus | null>(null);
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [reviewFindings, setReviewFindings] = useState<ConsistencyFinding[] | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!jobId) {
      setApplicationId(null);
      setTrackedStatus(null);
      return;
    }
    let cancelled = false;
    setStatus('checking');
    void getTrackedApplication(jobId).then((application) => {
      if (cancelled) return;
      if (application) {
        setApplicationId(application.id);
        setTrackedStatus(application.status);
      } else {
        setApplicationId(null);
        setTrackedStatus(null);
      }
      setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const save = useCallback(
    async (fields: Record<string, ReviewableField>, fillResults: FillResult[]) => {
      if (!jobId || status === 'saving') return;
      setStatus('saving');
      setErrorMessage(null);

      const { autofillSummary, unresolvedFields, answeredFields } =
        summarizeAutofillProgress(fields, fillResults);
      // IN_PROGRESS once the user has approved at least one field, SAVED otherwise — this is a
      // review-state fact (has real work happened here?), never a guess about submission.
      const hasApprovedWork = Object.values(fields).some(
        (field) => field.approvalState === 'APPROVED' || field.approvalState === 'EDITED',
      );

      const outcome = await saveApplication({
        jobId,
        status: hasApprovedWork ? 'IN_PROGRESS' : 'SAVED',
        autofillSummary,
        unresolvedFields,
        answeredFields,
      });

      if (outcome.status === 'ok') {
        setApplicationId(outcome.result.applicationId);
        setTrackedStatus(outcome.result.status);
        setStatus('saved');
        setLastSavedAt(Date.now());
      } else {
        setStatus('error');
        setErrorMessage(
          outcome.status === 'job_not_found'
            ? 'This job could not be found — try re-analyzing the page.'
            : outcome.message,
        );
      }
    },
    [jobId, status],
  );

  const submitMarkApplied = useCallback(
    async (acknowledged: Set<string>) => {
      if (!applicationId) return;
      setStatus('marking-applied');
      setErrorMessage(null);

      const outcome = await markApplied(applicationId, [...acknowledged]);
      if (outcome.status === 'ok') {
        setTrackedStatus('APPLIED');
        setReviewFindings(null);
        setAcknowledgedIds(new Set());
        setStatus('saved');
      } else if (outcome.status === 'consistency_check_failed') {
        // Authoritative — replaces whatever the earlier advisory GET showed, per the doc comment
        // above. Never silently retried with the same (now-stale) acknowledgements.
        setReviewFindings(outcome.result.findings);
        setAcknowledgedIds(new Set());
        setStatus('reviewing-consistency');
      } else {
        setStatus('error');
        setErrorMessage(
          outcome.status === 'not_found'
            ? 'This application could not be found.'
            : outcome.message,
        );
      }
    },
    [applicationId],
  );

  /** The popup's confirm step calls this first — advisory-checks for findings, and either
   * proceeds straight to marking applied (clean) or surfaces a review step (anything found). */
  const startMarkAsApplied = useCallback(async () => {
    if (
      !applicationId ||
      status === 'marking-applied' ||
      status === 'checking-consistency'
    )
      return;
    setStatus('checking-consistency');
    setErrorMessage(null);

    const result = await checkConsistency(applicationId);
    if (result.findings.length === 0) {
      await submitMarkApplied(new Set());
      return;
    }
    setReviewFindings(result.findings);
    setAcknowledgedIds(new Set());
    setStatus('reviewing-consistency');
  }, [applicationId, status, submitMarkApplied]);

  const toggleAcknowledgement = useCallback(
    (findingId: string, acknowledged: boolean) => {
      setAcknowledgedIds((prev) => {
        const next = new Set(prev);
        if (acknowledged) next.add(findingId);
        else next.delete(findingId);
        return next;
      });
    },
    [],
  );

  const confirmMarkAsApplied = useCallback(
    () => submitMarkApplied(acknowledgedIds),
    [acknowledgedIds, submitMarkApplied],
  );

  const cancelReview = useCallback(() => {
    setReviewFindings(null);
    setAcknowledgedIds(new Set());
    setStatus('idle');
  }, []);

  return {
    applicationId,
    trackedStatus,
    status,
    errorMessage,
    lastSavedAt,
    reviewFindings,
    acknowledgedIds,
    save,
    startMarkAsApplied,
    confirmMarkAsApplied,
    toggleAcknowledgement,
    cancelReview,
  };
}
