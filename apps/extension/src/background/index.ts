import contentScriptPath from '../content-script/index?script';
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
  if (message.type !== 'ANALYZE_JOB') return undefined;

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
