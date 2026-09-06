import { GMAIL_API_BASE_URL, GOOGLE_AUTH_URL, GOOGLE_OAUTH_SCOPES, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from './config';

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set — required for Gmail OAuth.',
    );
  }
  return { clientId, clientSecret };
}

/**
 * `access_type=offline` + `prompt=consent` on every connect attempt (not just first-time) —
 * without `prompt=consent`, Google silently omits the refresh token on a reconnect where it
 * still remembers a prior grant, which would otherwise only surface as a confusing failure much
 * later, the first time a sync tries to refresh an access token that was never actually
 * persisted. Costs one extra consent-screen click, always present.
 */
export function buildAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scope: string;
  emailAddress: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * Exchanges the OAuth `code` for tokens, then calls Gmail's own profile endpoint to learn the
 * connected mailbox address — no `email`/`openid` scope is requested (gmail.readonly alone is
 * sufficient for users.getProfile), keeping the scope set minimal.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const { clientId, clientSecret } = getClientCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  }
  const tokens = (await response.json()) as GoogleTokenResponse;
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token — this should not happen with prompt=consent set.',
    );
  }

  const profileResponse = await fetch(`${GMAIL_API_BASE_URL}/users/me/profile`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) {
    throw new Error(
      `Gmail profile lookup failed: ${profileResponse.status} ${await profileResponse.text()}`,
    );
  }
  const profile = (await profileResponse.json()) as { emailAddress: string };

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    emailAddress: profile.emailAddress,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status} ${await response.text()}`);
  }
  const tokens = (await response.json()) as GoogleTokenResponse;
  return tokens.access_token;
}

/**
 * Best-effort — logs but never throws, since local disconnect (deleting the email_connections
 * row) must proceed regardless of whether Google's revoke call itself succeeds. A
 * leaked-but-revoked token is inert either way once the row is gone and the key is never reused.
 */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
    if (!response.ok) {
      console.warn(`[career-os] Gmail token revocation returned ${response.status} — proceeding with local disconnect anyway.`);
    }
  } catch (error) {
    console.warn('[career-os] Gmail token revocation request failed — proceeding with local disconnect anyway.', error);
  }
}
