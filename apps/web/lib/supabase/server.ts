import { createSupabaseServerClient } from '@career-os/database';
import { cookies } from 'next/headers';

/**
 * The only place apps/web constructs a session-scoped Supabase client. Every server
 * component, server action, and route handler that needs to read/write the caller's own data
 * goes through this — never through the admin client (see lib/supabase/admin.ts), which
 * bypasses RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Called from a Server Component render, where cookies can't be set. The
        // middleware (middleware.ts) refreshes the session on every request instead, so
        // this is safe to swallow.
      }
    },
  });
}
