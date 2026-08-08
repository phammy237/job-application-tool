import { AnalyzeButton } from './components/AnalyzeButton';
import { DetectionState } from './components/DetectionState';
import { FieldList } from './components/FieldList';
import { JobSummary } from './components/JobSummary';
import { useAnalysis } from './hooks/useAnalysis';

export function App() {
  const { state, analyze } = useAnalysis();

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

      {state.status === 'result' ? (
        <>
          <JobSummary job={state.job} />
          <FieldList fields={state.fields} />
        </>
      ) : null}
    </div>
  );
}
