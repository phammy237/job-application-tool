import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createOwnEmailConnection, encryptRefreshToken, updateOwnGmailIntegrationEnabled } from '@career-os/database';
import { exchangeCodeForTokens } from '@career-os/email';
import { getCurrentUser } from '../../../../lib/auth';
import { getGoogleOAuthRedirectUri } from '../../../../lib/gmail-oauth-config';
import { isGmailIntegrationGloballyEnabled } from '../../../../lib/gmail-feature-gate';
import { createClient } from '../../../../lib/supabase/server';
import { OAUTH_STATE_COOKIE } from '../connect/route';

function stateMatches(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Top-level redirect target from Google — this is a real browser navigation, not a fetch() call,
 * so every failure path redirects to /settings with an error query param rather than returning a
 * raw error status a browser navigation can't meaningfully render. The `state` cookie set by
 * /api/gmail/connect survives this redirect because it's `SameSite=Lax`, which only withholds
 * cookies on cross-site subrequests/POSTs, not a top-level GET navigation like this one — so the
 * existing Supabase session cookie is present too, and "which user initiated this" is read from
 * that session, never inferred from anything Google's redirect carries.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  const response = (path: string) => {
    const redirectResponse = NextResponse.redirect(new URL(path, request.url));
    redirectResponse.cookies.delete(OAUTH_STATE_COOKIE);
    return redirectResponse;
  };

  if (!code || !state || !stateCookie || !stateMatches(stateCookie, state)) {
    return response('/settings?gmail_error=invalid_state');
  }

  const user = await getCurrentUser();
  if (!user) {
    return response('/settings?gmail_error=session_expired');
  }

  const supabase = await createClient();
  const enabled = await isGmailIntegrationGloballyEnabled(supabase);
  if (!enabled) {
    return response('/settings?gmail_error=not_enabled');
  }

  try {
    const tokens = await exchangeCodeForTokens(code, getGoogleOAuthRedirectUri());
    await createOwnEmailConnection(supabase, user.id, {
      emailAddress: tokens.emailAddress,
      encryptedRefreshToken: encryptRefreshToken(tokens.refreshToken),
      scopes: tokens.scope.split(' ').filter(Boolean),
    });
    // Connecting Gmail *is* the per-user opt-in (docs/USER_FLOWS.md §7) — flip the toggle now
    // that a connection genuinely exists, rather than requiring it as a precondition to connect.
    await updateOwnGmailIntegrationEnabled(supabase, user.id, true);
  } catch (error) {
    console.error('[career-os] Gmail OAuth callback failed', error);
    return response('/settings?gmail_error=connect_failed');
  }

  return response('/settings?gmail_connected=1');
}
