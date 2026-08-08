'use server';

import { revokeOwnExtensionSession } from '@career-os/database';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../lib/auth';
import { createAdminClient } from '../../../lib/supabase/admin';
import { createClient } from '../../../lib/supabase/server';

/**
 * Full account deletion (docs/USER_FLOWS.md §8, docs/SECURITY_AND_PRIVACY.md §5). Deleting
 * the auth.users row cascades through every user-owned table via the `on delete cascade`
 * foreign keys in supabase/migrations/0001_init.sql — there is no manual per-table cleanup
 * to keep in sync as new tables are added in later phases.
 *
 * Uses the service-role client, which is why this lives in a server action rather than a
 * regular RLS-scoped query: a user cannot delete their own auth.users row through the anon/
 * authenticated role. userId is taken from the verified session (requireUser), never from
 * client input.
 */
export async function deleteAccount() {
  const user = await requireUser();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    throw new Error(`Failed to delete account: ${error.message}`);
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect('/');
}

/** Revokes one of the caller's own extension sessions (docs/EXTENSION_DESIGN.md §4 — tokens
 * must be individually revocable from /settings). Uses the RLS-scoped client: a real session
 * exists here, so there's no need for the service-role client. */
export async function revokeExtensionSession(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await revokeOwnExtensionSession(supabase, user.id, id);
  revalidatePath('/settings');
}
