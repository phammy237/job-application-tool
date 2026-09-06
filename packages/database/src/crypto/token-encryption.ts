import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

/**
 * Reads and validates the key from the environment on every call, rather than caching it —
 * mirrors packages/ai/src/claude/client.ts's lazy-read-not-at-import-time intent (so this
 * package can be imported by tooling that never encrypts/decrypts without the env var set)
 * without the staleness a cached singleton would introduce if the env var is ever legitimately
 * different across calls within one process (e.g. test isolation). The read/decode cost is
 * trivial next to a Gmail API round-trip, so there's no performance reason to cache it.
 */
function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set — required to encrypt/decrypt Gmail refresh tokens. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}) — ` +
        're-generate it with the command in .env.example rather than editing it by hand.',
    );
  }
  return key;
}

/**
 * Reversible symmetric encryption for email_connections.encrypted_refresh_token — deliberately
 * different from extension-token.ts's one-way hashing (see that file's doc comment): a Gmail
 * refresh token must be decrypted to call Google's API, so a hash is unusable here. A fresh
 * random IV is generated on every call (never reused across encryptions with the same key), and
 * the GCM auth tag travels alongside the ciphertext so tampering is detected on decrypt rather
 * than silently producing corrupted plaintext.
 */
export function encryptRefreshToken(plaintextToken: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join('.');
}

/**
 * Throws on a malformed value or a failed auth-tag check (tampering, wrong key, or corruption)
 * rather than returning garbage — a caller must treat a thrown error here as "this token is not
 * usable," never fall back to treating the output as a valid refresh token.
 */
export function decryptRefreshToken(encrypted: string): string {
  const parts = encrypted.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted refresh token — expected "iv.authTag.ciphertext".');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
