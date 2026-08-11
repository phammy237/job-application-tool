import { reviewableFieldSchema, type ReviewableField } from '@career-os/shared';
import { z } from 'zod';

const reviewMapSchema = z.record(z.string(), reviewableFieldSchema);
export type ReviewMap = Record<string, ReviewableField>;

/** chrome.storage.local key prefix — one entry per analyzed job, so re-opening the popup on the
 * same job (without a fresh "Analyze Job" click) restores prior approve/edit/skip decisions
 * instead of losing them on popup close (docs/IMPLEMENTATION_PLAN.md Phase 4A: "Preserve state
 * across popup closure/page refresh when appropriate"). Not chrome.storage.sync — same rule as
 * the auth token in storage.ts: nothing about review decisions should propagate via the
 * browser's account sync. */
const KEY_PREFIX = 'careerOsReview:';

export async function getStoredReview(jobId: string): Promise<ReviewMap | null> {
  const key = `${KEY_PREFIX}${jobId}`;
  const result = await chrome.storage.local.get(key);
  const parsed = reviewMapSchema.safeParse(result[key]);
  return parsed.success ? parsed.data : null;
}

export async function setStoredReview(jobId: string, review: ReviewMap): Promise<void> {
  await chrome.storage.local.set({ [`${KEY_PREFIX}${jobId}`]: review });
}
