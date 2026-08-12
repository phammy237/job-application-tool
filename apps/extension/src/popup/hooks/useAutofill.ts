import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewableField } from '@career-os/shared';
import { getStoredFillResults, setStoredFillResults } from '../../lib/fill-result-storage';
import { isCurrentRequest, startRequest } from '../../lib/request-correlation';
import type { AutofillResult, ExtensionMessage } from '../../types/chrome-messages';

export type AutofillStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Drives the popup's Phase 4B trigger: sends the currently-approved fields to the background
 * (which injects the fill engine into the active tab — see background/index.ts and
 * content-script/autofill-entry.ts) and listens for the per-field results, the same
 * direct-content-script-to-popup messaging pattern useAnalysis.ts already uses. Holds no DOM
 * logic itself — this is messaging + result-state glue only.
 *
 * Phase 4C compatibility fix: results are persisted to chrome.storage.local per job (see
 * lib/fill-result-storage.ts) and hydrated on mount, so results survive the popup being closed
 * and reopened — needed for the save flow (Phase 4C) to read the latest autofill outcome even
 * when the user didn't keep the popup open after autofilling.
 *
 * Phase 4D fix: chrome.runtime.sendMessage is a broadcast (see chrome-messages.ts's doc
 * comment) — every AUTOFILL_RESULT/ERROR is tagged with the requestId this hook generated when
 * it triggered the fill, and a result whose requestId doesn't match the currently pending one
 * is discarded. Without this, a late result from a previous autofill run (a different tab, an
 * old page before the user navigated, a double click) could silently overwrite the current
 * job's fill results and get persisted under the wrong job's storage key.
 */
export function useAutofill(jobId: string | null) {
  const [status, setStatus] = useState<AutofillStatus>('idle');
  const [results, setResults] = useState<AutofillResult['results']>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    void getStoredFillResults(jobId).then((stored) => {
      if (cancelled || !stored) return;
      setResults(stored);
      setStatus('done');
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      if (message.type !== 'AUTOFILL_RESULT' && message.type !== 'AUTOFILL_ERROR') return;
      if (!isCurrentRequest(pendingRequestIdRef.current, message.requestId)) return; // stale — ignore

      if (message.type === 'AUTOFILL_RESULT') {
        setResults(message.results);
        setStatus('done');
        if (jobId) void setStoredFillResults(jobId, message.results);
      } else {
        setErrorMessage(message.message);
        setStatus('error');
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [jobId]);

  const runAutofill = useCallback((fields: ReviewableField[]) => {
    const requestId = startRequest();
    pendingRequestIdRef.current = requestId;
    setStatus('running');
    setErrorMessage(null);
    const message: ExtensionMessage = { type: 'AUTOFILL_APPROVED_FIELDS', requestId, fields };
    chrome.runtime.sendMessage(message);
  }, []);

  return { status, results, errorMessage, runAutofill };
}
