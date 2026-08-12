import type { AnalyzeJobError, AnalyzeJobRequest, AnalyzeJobResult } from '../types/chrome-messages';
import { extractJob } from './adapters/job-extractor';
import { detectFields } from './fields/detect-fields';

/**
 * Injected on demand by the background service worker via chrome.scripting.executeScript —
 * never declared as a static content_scripts entry in the manifest, so it never runs
 * automatically on page load (docs/EXTENSION_DESIGN.md §1, CLAUDE.md).
 *
 * Waits for the ANALYZE_JOB message (carrying the requestId the popup generated) rather than
 * running eagerly at injection time — mirrors autofill-entry.ts's pattern exactly (see
 * background/index.ts's comment on why the request arrives via a follow-up tabs.sendMessage
 * rather than executeScript args) and, since Phase 4D, is also what lets the result be
 * correlated back to the specific analyze that asked for it rather than broadcast blind.
 *
 * Reports its result back via chrome.runtime.sendMessage rather than relying on
 * chrome.scripting.executeScript's return-value capture (which doesn't reliably work for
 * `type: 'module'` content scripts) — the popup listens for this message directly. Read-only:
 * this script never writes to the page's DOM (autofill is a separate, later, user-approved step
 * starting Phase 4).
 */
chrome.runtime.onMessage.addListener((message: AnalyzeJobRequest, _sender, sendResponse) => {
  if (message.type !== 'ANALYZE_JOB') return undefined;

  try {
    const job = extractJob(window.location.href, document);
    const fields = detectFields(document);
    const response: AnalyzeJobResult = { type: 'ANALYZE_JOB_RESULT', requestId: message.requestId, job, fields };
    void chrome.runtime.sendMessage(response);
    sendResponse(response);
  } catch (error) {
    const response: AnalyzeJobError = {
      type: 'ANALYZE_JOB_ERROR',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : 'Could not analyze this page.',
    };
    void chrome.runtime.sendMessage(response);
    sendResponse(response);
  }
  return true;
});
