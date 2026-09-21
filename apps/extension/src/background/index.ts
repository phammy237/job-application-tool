import contentScriptPath from '../content-script/index?script';
import autofillEntryPath from '../content-script/autofill-entry?script';
import { isExternalTokenHandoffMessage } from '../types/chrome-messages';
import { setStoredAuth } from '../lib/storage';
import type { ExtensionMessage } from '../types/chrome-messages';

/**
 * `error.message` from a chrome.scripting/chrome.tabs failure (e.g. "Cannot access a chrome://
 * URL", "The extensions gallery cannot be scripted", "Could not establish connection. Receiving
 * end does not exist.") is genuinely useful for telling injection-failure apart from every other
 * stage of the analyze/autofill pipeline — but it's a browser-internal string, never anything
 * derived from page content or the user's bearer token, so surfacing it in development carries no
 * secret-exposure risk. Production still gets the plain, stage-only message: a real user hitting
 * "Cannot access a chrome:// URL" doesn't need the raw API name, and collapsing it there matches
 * this repo's existing posture of not leaking internals to end users. `import.meta.env.DEV` is
 * Vite's own build-time flag (same mechanism api-client.ts already uses for VITE_CAREER_OS_API_URL),
 * so this entire branch is dead code eliminated from a production build, not a runtime toggle.
 */
function describeError(stageMessage: string, error: unknown): string {
  if (!import.meta.env.DEV) return stageMessage;
  const detail = error instanceof Error ? error.message : String(error);
  return `${stageMessage} (${detail})`;
}

/**
 * Popup -> background -> content script relay (docs/EXTENSION_DESIGN.md §3 runtime flow). The
 * background worker is the only place chrome.scripting.executeScript is called — this is what
 * makes "content script only runs after an explicit user action" a fact enforced by which code
 * path can reach this call, not just a convention.
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'ANALYZE_JOB') {
    const analyzeRequest = message;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        sendResponse({
          type: 'ANALYZE_JOB_ERROR',
          requestId: analyzeRequest.requestId,
          message: 'No active tab found.',
        });
        return;
      }
      const tabId = tab.id;
      // Same two-step pattern as AUTOFILL_APPROVED_FIELDS below: executeScript's `files` form
      // can't take arguments directly, so the content script waits for this follow-up message
      // (carrying requestId) instead of running eagerly at injection time — see
      // content-script/index.ts's doc comment. The listener it registers as its first
      // synchronous action is guaranteed live by the time this promise resolves, so the
      // follow-up send can't race the injected script's readiness.
      chrome.scripting
        .executeScript({ target: { tabId }, files: [contentScriptPath] })
        .then(() => chrome.tabs.sendMessage(tabId, analyzeRequest))
        .catch((error: unknown) => {
          console.error('Failed to inject content script', error);
          sendResponse({
            type: 'ANALYZE_JOB_ERROR',
            requestId: analyzeRequest.requestId,
            message: describeError('Could not analyze this page.', error),
          });
        });
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === 'AUTOFILL_APPROVED_FIELDS') {
    const fillRequest = message;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        sendResponse({
          type: 'AUTOFILL_ERROR',
          requestId: fillRequest.requestId,
          message: 'No active tab found.',
        });
        return;
      }
      const tabId = tab.id;
      chrome.scripting
        .executeScript({ target: { tabId }, files: [autofillEntryPath] })
        .then(() => chrome.tabs.sendMessage(tabId, fillRequest))
        .catch((error: unknown) => {
          console.error('Failed to inject autofill content script', error);
          sendResponse({
            type: 'AUTOFILL_ERROR',
            requestId: fillRequest.requestId,
            message: describeError('Could not autofill this page.', error),
          });
        });
    });
    return true;
  }

  return undefined;
});

/**
 * The one-time token handoff from the Career OS web app (docs/EXTENSION_DESIGN.md §4).
 * `externally_connectable` in manifest.config.ts restricts which page origins may reach this
 * listener at all; this handler additionally validates the message shape strictly before
 * writing anything to storage, rather than trusting the manifest whitelist alone.
 */
chrome.runtime.onMessageExternal.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExternalTokenHandoffMessage(message)) return undefined;

  void setStoredAuth({ token: message.token, expiresAt: message.expiresAt }).then(() => {
    sendResponse({ ok: true });
  });
  return true;
});
