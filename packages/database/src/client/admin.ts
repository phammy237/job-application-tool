import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

/**
 * Service-role client. Bypasses Row Level Security entirely — per CLAUDE.md, every call site
 * using this client MUST independently filter by the authenticated user_id before reading or
 * writing a row. This is reserved for a small number of privileged server operations (e.g.
 * full account deletion, which must remove the auth.users row itself); it must never be
 * imported into client-side code, and must never be constructed with a client-derived value.
 *
 * Throws if accidentally evaluated in a browser bundle, as a last-resort guard.
 */
export function createSupabaseAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createSupabaseAdminClient() must never run in the browser — the service-role key bypasses RLS.',
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
