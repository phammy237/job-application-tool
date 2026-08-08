import 'server-only';
import {
  findActiveSessionByTokenHash,
  hashExtensionToken,
  touchExtensionSession,
} from '@career-os/database';
import { createAdminClient } from './supabase/admin';

const ROLLING_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The bearer-token counterpart to lib/auth.ts's getCurrentUser(). Route handlers the extension
 * calls (there's no cookie session to share with a browser extension) authenticate via this
 * instead. Deliberately a sibling module, not an addition to lib/auth.ts: that file's
 * requireUser() redirects on failure, which is the wrong contract for a route handler that must
 * return 401 JSON, and there's no session to derive here — only a token to verify.
 *
 * Returns the verified user_id, re-derived from extension_sessions — never trusted from any
 * client-supplied field (CLAUDE.md: "the extension never sends a trusted user_id").
 */
export async function getUserIdFromExtensionToken(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  const supabase = createAdminClient();
  const session = await findActiveSessionByTokenHash(supabase, hashExtensionToken(token));
  if (!session) return null;

  await touchExtensionSession(supabase, session.userId, session.id, {
    expiresAt: new Date(Date.now() + ROLLING_EXPIRY_MS).toISOString(),
  });

  return session.userId;
}
