import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

/**
 * The only sanctioned way to learn "who is making this request" anywhere in apps/web.
 * Always derives the user from the verified Supabase session — never from a client-supplied
 * id, form field, or query param. See CLAUDE.md "the extension never sends a trusted user_id"
 * (the same rule applies to every other client surface, including this app's own forms).
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** For server components / actions that require an authenticated user. Middleware already
 * redirects unauthenticated requests away from protected routes; this is the defense-in-depth
 * check for the route/action itself, per CLAUDE.md "RLS is the backstop, not the only check"
 * — applied here one layer up, at the auth boundary rather than the data boundary. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}
