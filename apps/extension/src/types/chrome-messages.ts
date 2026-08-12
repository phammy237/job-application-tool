import type { DetectedField, JobExtractionPayload, ReviewableField } from '@career-os/shared';
import type { FillResult } from '../content-script/fill/fill-engine';

/** Popup -> background: user clicked "Analyze Job". */
export interface AnalyzeJobRequest {
  type: 'ANALYZE_JOB';
}

/** Content script -> background -> popup: the combined extraction + field-detection result. */
export interface AnalyzeJobResult {
  type: 'ANALYZE_JOB_RESULT';
  job: JobExtractionPayload;
  fields: DetectedField[];
}

export interface AnalyzeJobError {
  type: 'ANALYZE_JOB_ERROR';
  message: string;
}

/**
 * Popup -> background -> content script: fill only these fields (Phase 4B). Carries the popup's
 * own ReviewableField objects (already-typed, reused rather than duplicated into a bespoke DTO)
 * — the fill engine independently re-validates approvalState/reviewState/classification on the
 * receiving end regardless of what this payload claims, since it runs in a separate script
 * execution reached only via this message, not a direct call the popup's own guards could gate.
 */
export interface AutofillApprovedFieldsRequest {
  type: 'AUTOFILL_APPROVED_FIELDS';
  fields: ReviewableField[];
}

/** Content script -> popup: per-field fill outcomes. */
export interface AutofillResult {
  type: 'AUTOFILL_RESULT';
  results: FillResult[];
}

export interface AutofillError {
  type: 'AUTOFILL_ERROR';
  message: string;
}

export type ExtensionMessage =
  | AnalyzeJobRequest
  | AnalyzeJobResult
  | AnalyzeJobError
  | AutofillApprovedFieldsRequest
  | AutofillResult
  | AutofillError;

/**
 * Sent from the Career OS web app (docs/EXTENSION_DESIGN.md §4's one-time token handoff) via
 * chrome.runtime.sendMessage, not from within the extension itself — kept separate from
 * ExtensionMessage above so the two message spaces (internal vs. externally_connectable) can't
 * be confused with each other. The background's onMessageExternal listener validates this shape
 * strictly before writing anything to storage.
 */
export interface ExternalTokenHandoffMessage {
  type: 'CAREER_OS_EXTENSION_TOKEN';
  token: string;
  expiresAt: string;
}

export function isExternalTokenHandoffMessage(
  message: unknown,
): message is ExternalTokenHandoffMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'CAREER_OS_EXTENSION_TOKEN' &&
    typeof (message as { token?: unknown }).token === 'string' &&
    typeof (message as { expiresAt?: unknown }).expiresAt === 'string'
  );
}
