import { createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX = 'cosext_';

/**
 * Raw bearer token shown to the caller exactly once (POST /api/auth/extension-token's
 * response). Never persisted in this form — only hashExtensionToken's output is stored, in
 * extension_sessions.token_hash.
 */
export function generateExtensionToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * One-way, deterministic hash so a presented token can be looked up by its hash directly
 * (`.eq('token_hash', hashExtensionToken(token))`) rather than requiring a compare-against-every-
 * row loop. This is deliberately different from TOKEN_ENCRYPTION_KEY's symmetric encryption
 * (used for Gmail refresh tokens, which must be decrypted to call Google's API) — an extension
 * bearer token is only ever compared, never decrypted, so a plain hash needs no key management.
 */
export function hashExtensionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
