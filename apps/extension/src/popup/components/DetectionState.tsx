import type { AnalysisState } from '../hooks/useAnalysis';

const LABELS: Record<AnalysisState['status'], string> = {
  'checking-auth': 'Checking connection…',
  'not-connected': 'Not connected',
  idle: 'Not analyzed yet',
  analyzing: 'Analyzing…',
  result: 'Analysis complete',
  error: 'Something went wrong',
};

export function DetectionState({ status }: { status: AnalysisState['status'] }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: '#666', fontWeight: 500 }}>{LABELS[status]}</p>
  );
}
