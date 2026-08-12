import contentScriptPath from '../content-script/index?script';
import autofillEntryPath from '../content-script/autofill-entry?script';
import { isExternalTokenHandoffMessage } from '../types/chrome-messages';
import { setStoredAuth } from '../lib/storage';
import type { ExtensionMessage } from '../types/chrome-messages';

/**
 * Popup -> background -> content script relay (docs/EXTENSION_DESIGN.md §3 runtime flow). The
 * background worker is the only place chrome.scripting.executeScript is called — this is what
 * makes "content script only runs after an explicit user action" a fact enforced by which code
 * path can reach this call, not just a convention.
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'ANALYZE_JOB') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        sendResponse({ type: 'ANALYZE_JOB_ERROR', message: 'No active tab found.' });
        return;
      }
      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: [contentScriptPath] })
        .catch((error: unknown) => {
          console.error('Failed to inject content script', error);
          sendResponse({
            type: 'ANALYZE_JOB_ERROR',
            message: 'Could not analyze this page.',
          });
        });
    });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === 'AUTOFILL_APPROVED_FIELDS') {
    const fillRequest = message;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        sendResponse({ type: 'AUTOFILL_ERROR', message: 'No active tab found.' });
        return;
      }
      const tabId = tab.id;
      // executeScript's `files` form can't take arguments directly (unlike its `func` form,
      // which would require inlining the whole fill engine as a self-contained function string
      // instead of importing it — see autofill-entry.ts's doc comment). The listener it
      // registers as its first synchronous action is guaranteed live by the time this promise
      // resolves, so this follow-up send can't race the injected script's readiness.
      chrome.scripting
        .executeScript({ target: { tabId }, files: [autofillEntryPath] })
        .then(() => chrome.tabs.sendMessage(tabId, fillRequest))
        .catch((error: unknown) => {
          console.error('Failed to inject autofill content script', error);
          sendResponse({
            type: 'AUTOFILL_ERROR',
            message: 'Could not autofill this page.',
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
