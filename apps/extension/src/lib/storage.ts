import { z } from 'zod';

const authSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
});
export type StoredAuth = z.infer<typeof authSchema>;

const AUTH_KEY = 'careerOsAuth';

/** chrome.storage.local, not sync — nothing about the user's activity should propagate via the
 * browser's account sync (docs/EXTENSION_DESIGN.md §1). Zod-validated on read so a corrupted or
 * unexpectedly-shaped stored value fails closed (treated as "not connected") rather than being
 * used as-is. */
export async function getStoredAuth(): Promise<StoredAuth | null> {
  const result = await chrome.storage.local.get(AUTH_KEY);
  const parsed = authSchema.safeParse(result[AUTH_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function setStoredAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
}

export async function clearStoredAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}
