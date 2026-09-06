import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@career-os/email';
import { getCurrentUser } from '../../../../lib/auth';
import { getGoogleOAuthRedirectUri } from '../../../../lib/gmail-oauth-config';
import { isGmailIntegrationGloballyEnabled } from '../../../../lib/gmail-feature-gate';
import { createClient } from '../../../../lib/supabase/server';

export const OAUTH_STATE_COOKIE = 'gmail_oauth_state';
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/**
 * Returns the Google auth URL as JSON rather than redirecting directly — this is `fetch()`-called
 * from the /settings "Connect Gmail" button (a client component), which navigates the browser
 * itself via `window.location.href`. The CSRF-protection `state` nonce is stored in a short-lived
 * httpOnly cookie rather than a database row: it's single-use, expires in 10 minutes, and needs
 * no server-side lookup — `/api/gmail/callback` just compares the cookie value to the query
 * param it receives back from Google.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const enabled = await isGmailIntegrationGloballyEnabled(supabase);
  if (!enabled) {
    return NextResponse.json({ error: 'Gmail sync is not enabled for this account' }, { status: 403 });
  }

  const state = randomBytes(32).toString('base64url');
  const authUrl = buildAuthUrl(state, getGoogleOAuthRedirectUri());

  const response = NextResponse.json({ authUrl });
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return response;
}
