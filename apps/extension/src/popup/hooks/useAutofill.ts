import { useCallback, useEffect, useState } from 'react';
import type { ReviewableField } from '@career-os/shared';
import type { AutofillResult, ExtensionMessage } from '../../types/chrome-messages';

export type AutofillStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Drives the popup's Phase 4B trigger: sends the currently-approved fields to the background
 * (which injects the fill engine into the active tab — see background/index.ts and
 * content-script/autofill-entry.ts) and listens for the per-field results, the same
 * direct-content-script-to-popup messaging pattern useAnalysis.ts already uses. Holds no DOM
 * logic itself — this is messaging + result-state glue only.
 */
export function useAutofill() {
  const [status, setStatus] = useState<AutofillStatus>('idle');
  const [results, setResults] = useState<AutofillResult['results']>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      if (message.type === 'AUTOFILL_RESULT') {
        setResults(message.results);
        setStatus('done');
      } else if (message.type === 'AUTOFILL_ERROR') {
        setErrorMessage(message.message);
        setStatus('error');
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const runAutofill = useCallback((fields: ReviewableField[]) => {
    setStatus('running');
    setErrorMessage(null);
    const message: ExtensionMessage = { type: 'AUTOFILL_APPROVED_FIELDS', fields };
    chrome.runtime.sendMessage(message);
  }, []);

  return { status, results, errorMessage, runAutofill };
}
