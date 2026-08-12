import {
  fieldApprovalStateSchema,
  fieldClassificationSchema,
  fieldReviewStateSchema,
  generatedAnswerSchema,
  type ReviewableField,
} from '@career-os/shared';
import { z } from 'zod';
import { fingerprintField } from './field-fingerprint';

const fingerprintSchema = z.object({
  htmlName: z.string().nullable(),
  htmlId: z.string().nullable(),
  classification: fieldClassificationSchema,
  label: z.string().nullable(),
  inputType: z.string(),
  currentValueHash: z.string().nullable(),
});

/**
 * What actually gets written to chrome.storage.local — a fingerprint (never the field's raw
 * current value, see field-fingerprint.ts) plus the review decision itself. Deliberately not
 * ReviewableField: that type carries the full DetectedField (including raw currentValue), which
 * must stay in memory for the live popup session only, never persisted verbatim.
 */
const persistedFieldSchema = z.object({
  fingerprint: fingerprintSchema,
  reviewState: fieldReviewStateSchema,
  approvalState: fieldApprovalStateSchema,
  suggestion: generatedAnswerSchema.nullable(),
  editedText: z.string().nullable(),
});
const persistedReviewSchema = z.record(z.string(), persistedFieldSchema);
export type PersistedReview = z.infer<typeof persistedReviewSchema>;

/** chrome.storage.local key prefix — one entry per analyzed job, so re-opening the popup on the
 * same job (without a fresh "Analyze Job" click) restores prior approve/edit/skip decisions
 * instead of losing them on popup close (docs/IMPLEMENTATION_PLAN.md Phase 4A: "Preserve state
 * across popup closure/page refresh when appropriate"). Not chrome.storage.sync — same rule as
 * the auth token in storage.ts: nothing about review decisions should propagate via the
 * browser's account sync. Restoring a stored entry against the live page is the reducer's job
 * (review-reducer.ts's HYDRATE case) — every stored entry is only ever a candidate, matched
 * against a fresh field-by-field fingerprint comparison, never trusted outright. */
const KEY_PREFIX = 'careerOsReview:';

export async function getStoredReview(jobId: string): Promise<PersistedReview | null> {
  const key = `${KEY_PREFIX}${jobId}`;
  const result = await chrome.storage.local.get(key);
  const parsed = persistedReviewSchema.safeParse(result[key]);
  return parsed.success ? parsed.data : null;
}

export async function setStoredReview(
  jobId: string,
  review: Record<string, ReviewableField>,
): Promise<void> {
  const persisted: PersistedReview = {};
  for (const [fieldId, field] of Object.entries(review)) {
    persisted[fieldId] = {
      fingerprint: fingerprintField(field.detected),
      reviewState: field.reviewState,
      approvalState: field.approvalState,
      suggestion: field.suggestion,
      editedText: field.editedText,
    };
  }
  await chrome.storage.local.set({ [`${KEY_PREFIX}${jobId}`]: persisted });
}
