import type { AnalyzeJobError, AnalyzeJobResult } from '../types/chrome-messages';
import { extractJob } from './adapters/job-extractor';
import { detectFields } from './fields/detect-fields';

/**
 * Injected on demand by the background service worker via chrome.scripting.executeScript —
 * never declared as a static content_scripts entry in the manifest, so it never runs
 * automatically on page load (docs/EXTENSION_DESIGN.md §1, CLAUDE.md).
 *
 * Reports its result back via chrome.runtime.sendMessage rather than relying on
 * chrome.scripting.executeScript's return-value capture (which doesn't reliably work for
 * `type: 'module'` content scripts) — the popup listens for this message directly. Read-only:
 * this script never writes to the page's DOM (autofill is a separate, later, user-approved step
 * starting Phase 4).
 */
try {
  const job = extractJob(window.location.href, document);
  const fields = detectFields(document);
  const message: AnalyzeJobResult = { type: 'ANALYZE_JOB_RESULT', job, fields };
  void chrome.runtime.sendMessage(message);
} catch (error) {
  const message: AnalyzeJobError = {
    type: 'ANALYZE_JOB_ERROR',
    message: error instanceof Error ? error.message : 'Could not analyze this page.',
  };
  void chrome.runtime.sendMessage(message);
}
