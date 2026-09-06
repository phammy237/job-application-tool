import 'server-only';

/** Kept as its own explicit env var rather than derived from NEXT_PUBLIC_APP_URL at runtime, so
 * the Google Cloud Console "Authorized redirect URI" entry has one canonical value per
 * environment, independently settable for a preview deployment if ever needed. */
export function getGoogleOAuthRedirectUri(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!uri) {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI is not set — required for Gmail OAuth.');
  }
  return uri;
}
