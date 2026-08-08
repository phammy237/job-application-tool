import { useCallback, useEffect, useState } from 'react';
import type { DetectedField, JobExtractionPayload } from '@career-os/shared';
import { analyzeJob } from '../../lib/api-client';
import { getStoredAuth } from '../../lib/storage';
import type { ExtensionMessage } from '../../types/chrome-messages';

export type AnalysisState =
  | { status: 'checking-auth' }
  | { status: 'not-connected' }
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'result'; job: JobExtractionPayload; fields: DetectedField[]; jobId: string }
  | { status: 'error'; message: string };

/**
 * Drives the popup's Phase 2 flow (docs/EXTENSION_DESIGN.md §3): check connection state on
 * mount, relay "Analyze Job" to the background worker, listen for the content script's result,
 * persist the extraction via the Career OS API, and surface the classified field list. No
 * suggestions, no autofill — that's Phase 3/4.
 */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ status: 'checking-auth' });

  useEffect(() => {
    void getStoredAuth().then((auth) => {
      setState(auth ? { status: 'idle' } : { status: 'not-connected' });
    });
  }, []);

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      if (message.type === 'ANALYZE_JOB_RESULT') {
        analyzeJob(message.job)
          .then(({ jobId }) => {
            setState({ status: 'result', job: message.job, fields: message.fields, jobId });
          })
          .catch((error: unknown) => {
            setState({
              status: 'error',
              message:
                error instanceof Error ? error.message : 'Could not save the analyzed job.',
            });
          });
      } else if (message.type === 'ANALYZE_JOB_ERROR') {
        setState({ status: 'error', message: message.message });
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const analyze = useCallback(() => {
    setState({ status: 'analyzing' });
    const message: ExtensionMessage = { type: 'ANALYZE_JOB' };
    chrome.runtime.sendMessage(message);
  }, []);

  return { state, analyze };
}
