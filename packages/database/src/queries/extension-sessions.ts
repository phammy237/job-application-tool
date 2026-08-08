import { extensionSessionSchema, type ExtensionSession } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

function rowToExtensionSession(row: {
  id: string;
  user_id: string;
  device_label: string | null;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}): ExtensionSession {
  return extensionSessionSchema.parse({
    id: row.id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  });
}

export async function createOwnExtensionSession(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { tokenHash: string; deviceLabel: string | null; expiresAt: string },
): Promise<ExtensionSession> {
  const { data, error } = await supabase
    .from('extension_sessions')
    .insert({
      user_id: userId,
      token_hash: input.tokenHash,
      device_label: input.deviceLabel,
      expires_at: input.expiresAt,
    })
    .select('id, user_id, device_label, last_used_at, expires_at, revoked_at, created_at')
    .single();
  return rowToExtensionSession(unwrapRow(data, error, 'createOwnExtensionSession'));
}

/**
 * Deliberately selects an explicit column list that excludes token_hash — not just omitted
 * from the mapped result, omitted from the SQL query itself, so the hash never travels over
 * the wire for a list read (this backs the /settings "connected devices" UI).
 */
export async function listOwnExtensionSessions(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<ExtensionSession[]> {
  const { data, error } = await supabase
    .from('extension_sessions')
    .select('id, user_id, device_label, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnExtensionSessions');
  return (data ?? []).map(rowToExtensionSession);
}

export async function revokeOwnExtensionSession(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('extension_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'revokeOwnExtensionSession');
}

/**
 * The one function in this file that cannot filter by user_id — it's the lookup that
 * *establishes* user_id from an admin-client context with no session yet (the extension's
 * bearer-token auth path). Every other query on this table happens after user_id is known.
 */
export async function findActiveSessionByTokenHash(
  supabase: CareerOsSupabaseClient,
  tokenHash: string,
): Promise<{ userId: string; id: string } | null> {
  const { data, error } = await supabase
    .from('extension_sessions')
    .select('id, user_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  assertNoError(error, 'findActiveSessionByTokenHash');
  return data ? { userId: data.user_id, id: data.id } : null;
}

/** Rolling-expiry bump on each successful bearer-token verification. Filtered by both `id` and
 * `userId` even though the caller already trusts `id` — defense in depth, since this runs via
 * the admin client (CLAUDE.md: service-role paths must independently filter by user_id). */
export async function touchExtensionSession(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  input: { expiresAt: string },
): Promise<void> {
  const { error } = await supabase
    .from('extension_sessions')
    .update({ last_used_at: new Date().toISOString(), expires_at: input.expiresAt })
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'touchExtensionSession');
}
