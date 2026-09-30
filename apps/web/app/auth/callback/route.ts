import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '../../../lib/safe-redirect-path';
import { createClient } from '../../../lib/supabase/server';

/**
 * Handles the redirect Supabase sends after a user clicks their email confirmation link (or,
 * later, an OAuth provider callback). Exchanges the one-time `code` for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
