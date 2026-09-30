import 'server-only';
import {
  decryptRefreshToken,
  getOwnEmailConnectionWithToken,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { revokeToken } from '@career-os/email';

/** Matches apps/web/app/api/profile/resume-import/analyze/route.ts — objects live at
 * "<user_id>/<content_hash>.pdf". */
const RESUME_UPLOADS_BUCKET = 'resume-uploads';
const STORAGE_LIST_PAGE_SIZE = 1000;

/**
 * Deleting the auth.users row cascades through every user-owned *table*, but two things live
 * outside Postgres' cascade and would otherwise outlive the account:
 * - the Gmail OAuth grant at Google (the local encrypted token row cascades away, but the grant
 *   itself stays live until revoked — same reasoning as /api/gmail/disconnect);
 * - uploaded résumé PDFs in Supabase Storage (storage.objects has no FK to auth.users).
 *
 * Must run *before* the auth user is deleted — afterwards the token row is already gone.
 * Gmail revocation is best-effort (revokeToken never throws, and a decrypt failure is logged, not
 * fatal); storage removal failures throw, so the caller aborts rather than reporting a deletion
 * that left the user's résumé files behind.
 */
export async function purgeAccountExternalData(
  supabase: CareerOsSupabaseClient,
  admin: CareerOsSupabaseClient,
  userId: string,
): Promise<void> {
  const connection = await getOwnEmailConnectionWithToken(supabase, userId);
  if (connection) {
    try {
      await revokeToken(decryptRefreshToken(connection.encryptedRefreshToken));
    } catch (error) {
      console.warn(
        '[career-os] Could not decrypt Gmail token during account deletion — skipping revocation.',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const bucket = admin.storage.from(RESUME_UPLOADS_BUCKET);
  // Removing a page shifts the listing, so always re-read from offset 0 until it's empty.
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: STORAGE_LIST_PAGE_SIZE });
    if (error) throw new Error(`Failed to list résumé uploads: ${error.message}`);
    if (!data || data.length === 0) return;

    const paths = data.map((object) => `${userId}/${object.name}`);
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw new Error(`Failed to delete résumé uploads: ${removeError.message}`);
  }
}
