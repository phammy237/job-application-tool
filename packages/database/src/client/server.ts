import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { Database } from '../types/database.types';

/**
 * Server-side Supabase client, RLS-scoped to the caller's session. This package stays
 * framework-agnostic: the caller (apps/web) supplies a cookie adapter backed by
 * `next/headers`, rather than this package importing Next.js directly. See
 * apps/web/lib/supabase/server.ts for the wiring.
 */
export function createSupabaseServerClient(cookies: CookieMethodsServer) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }
  return createServerClient<Database>(url, anonKey, { cookies });
}

export type { CookieMethodsServer };
