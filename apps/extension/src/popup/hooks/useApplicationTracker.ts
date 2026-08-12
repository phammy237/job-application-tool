import { useCallback, useEffect, useState } from 'react';
import type { ApplicationStatus, ReviewableField } from '@career-os/shared';
import { getTrackedApplication, markApplied, saveApplication } from '../../lib/api-client';
import type { FillResult } from '../../content-script/fill/fill-engine';
import { summarizeAutofillProgress } from '../lib/summarize-autofill';

export type TrackerStatus = 'idle' | 'checking' | 'saving' | 'saved' | 'error' | 'marking-applied';

/**
 * Drives the popup's Phase 4C save/update/mark-applied flow. On mount (once a job has been
 * analyzed), checks whether the job is already tracked; `save()` computes the sanitized
 * autofill summary from the current review/fill state and upserts it; `markAsApplied()` is a
 * fully separate call the UI must gate behind its own explicit confirmation — this hook never
 * calls it on its own, and `save()` never implies it (docs/IMPLEMENTATION_PLAN.md Phase 4C:
 * "no fill, save, navigation, or page event automatically marks the application applied").
 */
export function useApplicationTracker(jobId: string | null) {
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<ApplicationStatus | null>(null);
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

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

      const { autofillSummary, unresolvedFields, answeredFields } = summarizeAutofillProgress(
        fields,
        fillResults,
      );
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

  const markAsApplied = useCallback(async () => {
    if (!applicationId || status === 'marking-applied') return;
    setStatus('marking-applied');
    setErrorMessage(null);

    const outcome = await markApplied(applicationId);
    if (outcome.status === 'ok') {
      setTrackedStatus('APPLIED');
      setStatus('saved');
    } else {
      setStatus('error');
      setErrorMessage(
        outcome.status === 'not_found'
          ? 'This application could not be found.'
          : outcome.message,
      );
    }
  }, [applicationId, status]);

  return { applicationId, trackedStatus, status, errorMessage, lastSavedAt, save, markAsApplied };
}
