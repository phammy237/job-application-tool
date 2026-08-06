'use server';

import { redirect } from 'next/navigation';
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
