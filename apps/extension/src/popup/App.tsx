import { AnalyzeButton } from './components/AnalyzeButton';
import { ApplicationTracker } from './components/ApplicationTracker';
import { DetectionState } from './components/DetectionState';
import { FieldList } from './components/FieldList';
import { JobSummary } from './components/JobSummary';
import { useAnalysis } from './hooks/useAnalysis';
import { useApplicationTracker } from './hooks/useApplicationTracker';
import { useAutofill } from './hooks/useAutofill';
import { useFieldReview } from './hooks/useFieldReview';

export function App() {
  const { state, analyze } = useAnalysis();
  const isResult = state.status === 'result';
  const jobId = isResult ? state.jobId : null;

  const review = useFieldReview(jobId, isResult ? state.fields : []);
  const autofill = useAutofill(jobId);
  const tracker = useApplicationTracker(jobId);

  const approvedFields = Object.values(review.fields).filter(
    (field) => field.approvalState === 'APPROVED' || field.approvalState === 'EDITED',
  );

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 16, margin: 0 }}>Career OS</h1>

      <DetectionState status={state.status} />

      {state.status === 'not-connected' ? (
        <p style={{ fontSize: 13, color: '#666' }}>
          Connect this extension from Career OS Settings, then reopen this popup.
        </p>
      ) : (
        <AnalyzeButton
          disabled={state.status === 'checking-auth' || state.status === 'analyzing'}
          analyzing={state.status === 'analyzing'}
          onClick={analyze}
        />
      )}

      {state.status === 'error' ? (
        <p style={{ fontSize: 13, color: '#b91c1c' }}>{state.message}</p>
      ) : null}

      {isResult ? (
        <>
          <JobSummary job={state.job} />
          <FieldList
            fields={review.fields}
            loadingIds={review.loadingIds}
            onRequestSuggestion={(fieldId) => void review.requestSuggestionFor(fieldId)}
            onRequestAllSuggestions={() => void review.requestSuggestionsForAllEligible()}
            onApprove={review.approve}
            onSkip={review.skip}
            onEdit={review.edit}
            onResetDecision={review.resetDecision}
            onApproveAllEligible={review.approveAllEligible}
            fillResults={autofill.results}
            canAutofill={approvedFields.length > 0}
            autofillRunning={autofill.status === 'running'}
            onAutofill={() => autofill.runAutofill(approvedFields)}
          />
          {autofill.status === 'error' && autofill.errorMessage ? (
            <p style={{ fontSize: 13, color: '#b91c1c' }}>{autofill.errorMessage}</p>
          ) : null}

          <ApplicationTracker
            applicationId={tracker.applicationId}
            trackedStatus={tracker.trackedStatus}
            status={tracker.status}
            errorMessage={tracker.errorMessage}
            lastSavedAt={tracker.lastSavedAt}
            onSave={() => void tracker.save(review.fields, autofill.results)}
            onMarkApplied={() => void tracker.markAsApplied()}
          />
        </>
      ) : null}
    </div>
  );
}
