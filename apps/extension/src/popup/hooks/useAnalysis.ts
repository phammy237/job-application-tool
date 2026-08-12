import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectedField, JobExtractionPayload } from '@career-os/shared';
import { analyzeJob } from '../../lib/api-client';
import { isCurrentRequest, startRequest } from '../../lib/request-correlation';
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
 * persist the extraction via the Career OS API, and surface the classified field list.
 *
 * chrome.runtime.sendMessage is a broadcast (see chrome-messages.ts's doc comment) — every
 * ANALYZE_JOB_RESULT/ERROR message is tagged with the requestId this hook generated when it
 * sent the request, and any incoming message whose requestId doesn't match the currently
 * pending one is discarded. Without this, a result from a previous "Analyze Job" click (a
 * different tab, a closed-and-reopened popup, a double click) could silently overwrite the
 * current view with the wrong job's data (docs/IMPLEMENTATION_PLAN.md Phase 4D).
 */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ status: 'checking-auth' });
  const pendingRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    void getStoredAuth().then((auth) => {
      setState(auth ? { status: 'idle' } : { status: 'not-connected' });
    });
  }, []);

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      if (message.type !== 'ANALYZE_JOB_RESULT' && message.type !== 'ANALYZE_JOB_ERROR') return;
      if (!isCurrentRequest(pendingRequestIdRef.current, message.requestId)) return; // stale — ignore

      if (message.type === 'ANALYZE_JOB_RESULT') {
        analyzeJob(message.job)
          .then(({ jobId }) => {
            if (!isCurrentRequest(pendingRequestIdRef.current, message.requestId)) return;
            setState({ status: 'result', job: message.job, fields: message.fields, jobId });
          })
          .catch((error: unknown) => {
            if (!isCurrentRequest(pendingRequestIdRef.current, message.requestId)) return;
            setState({
              status: 'error',
              message:
                error instanceof Error ? error.message : 'Could not save the analyzed job.',
            });
          });
      } else {
        setState({ status: 'error', message: message.message });
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const analyze = useCallback(() => {
    const requestId = startRequest();
    pendingRequestIdRef.current = requestId;
    setState({ status: 'analyzing' });
    const message: ExtensionMessage = { type: 'ANALYZE_JOB', requestId };
    chrome.runtime.sendMessage(message);
  }, []);

  return { state, analyze };
}
