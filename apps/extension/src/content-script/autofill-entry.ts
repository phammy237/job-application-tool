import { runFillEngine } from './fill/fill-engine';
import type { AutofillApprovedFieldsRequest, AutofillError, AutofillResult } from '../types/chrome-messages';

/**
 * Injected on demand by the background service worker via chrome.scripting.executeScript, only
 * after the user clicks "Autofill approved fields" in the popup — same explicit-user-action
 * model as content-script/index.ts, never a static content_scripts entry. Runs against the
 * document of the tab it was targeted at, and only that tab — chrome.scripting.executeScript's
 * `target: { tabId }` in background/index.ts is what enforces this, not anything in this file.
 *
 * Registers this listener as its very first synchronous action (required — see background/
 * index.ts's comment on why the fields payload arrives via a follow-up tabs.sendMessage rather
 * than executeScript args) and does nothing else until it receives the approved-fields payload.
 * All DOM mutation happens inside runFillEngine — this file is messaging glue only.
 */
chrome.runtime.onMessage.addListener(
  (message: AutofillApprovedFieldsRequest, _sender, sendResponse) => {
    if (message.type !== 'AUTOFILL_APPROVED_FIELDS') return undefined;

    try {
      const results = runFillEngine(document, message.fields);
      const response: AutofillResult = { type: 'AUTOFILL_RESULT', requestId: message.requestId, results };
      void chrome.runtime.sendMessage(response);
      sendResponse(response);
    } catch (error) {
      const response: AutofillError = {
        type: 'AUTOFILL_ERROR',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : 'Could not autofill this page.',
      };
      void chrome.runtime.sendMessage(response);
      sendResponse(response);
    }
    return true;
  },
);
