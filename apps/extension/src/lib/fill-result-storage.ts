import { z } from 'zod';

const fillResultSchema = z.object({
  fieldId: z.string(),
  status: z.enum(['success', 'skipped', 'failed', 'stale', 'unsupported', 'requires_rescan']),
  reason: z.string(),
});
const fillResultsSchema = z.array(fillResultSchema);
export type StoredFillResults = z.infer<typeof fillResultsSchema>;

/**
 * Phase 4B's AUTOFILL_RESULT lived only in the popup's React state (useAutofill.ts), populated
 * by a chrome.runtime.onMessage listener — closing the popup destroyed it, so a user who
 * autofilled a page, closed the popup, then reopened it to save the application would see no
 * fill results at all. This is the compatibility fix (docs/IMPLEMENTATION_PLAN.md Phase 4C):
 * persist results to chrome.storage.local keyed per job, mirroring review-storage.ts's existing
 * pattern exactly. Only status/reason/fieldId are stored — same as FillResult itself, which
 * never carries a value or DOM locator, so there's nothing new to minimize here.
 */
const KEY_PREFIX = 'careerOsFillResults:';

export async function getStoredFillResults(jobId: string): Promise<StoredFillResults | null> {
  const key = `${KEY_PREFIX}${jobId}`;
  const result = await chrome.storage.local.get(key);
  const parsed = fillResultsSchema.safeParse(result[key]);
  return parsed.success ? parsed.data : null;
}

export async function setStoredFillResults(jobId: string, results: StoredFillResults): Promise<void> {
  await chrome.storage.local.set({ [`${KEY_PREFIX}${jobId}`]: results });
}
