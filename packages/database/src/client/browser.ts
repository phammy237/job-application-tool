import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '../types/database.types';

/**
 * Client-side Supabase client — anon key only, RLS-scoped to the logged-in user's session.
 * Never construct this with the service-role key.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
