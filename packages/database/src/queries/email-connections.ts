import { emailConnectionSchema, type EmailConnection } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

const PUBLIC_COLUMNS =
  'id, user_id, provider, email_address, scopes, status, last_synced_at, created_at, updated_at';

function rowToEmailConnection(row: {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  scopes: string[];
  status: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}): EmailConnection {
  return emailConnectionSchema.parse({
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    emailAddress: row.email_address,
    scopes: row.scopes,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function createOwnEmailConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { emailAddress: string; encryptedRefreshToken: string; scopes: string[] },
): Promise<EmailConnection> {
  const { data, error } = await supabase
    .from('email_connections')
    .insert({
      user_id: userId,
      email_address: input.emailAddress,
      encrypted_refresh_token: input.encryptedRefreshToken,
      scopes: input.scopes,
      status: 'ACTIVE',
    })
    .select(PUBLIC_COLUMNS)
    .single();
  return rowToEmailConnection(unwrapRow(data, error, 'createOwnEmailConnection'));
}

/** Deliberately selects an explicit column list that excludes encrypted_refresh_token — not
 * just omitted from the mapped result, omitted from the SQL query itself, so the encrypted
 * token never travels over the wire for the /settings "connected mailbox" read. Mirrors
 * listOwnExtensionSessions excluding token_hash. */
export async function getOwnEmailConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<EmailConnection | null> {
  const { data, error } = await supabase
    .from('email_connections')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnEmailConnection');
  return data ? rowToEmailConnection(data) : null;
}

/** The one function in this module that selects encrypted_refresh_token — named distinctly so
 * the exception is obvious. Called only from packages/email's sync/oauth-refresh path, never
 * from a route handler or component directly. */
export async function getOwnEmailConnectionWithToken(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<(EmailConnection & { encryptedRefreshToken: string }) | null> {
  const { data, error } = await supabase
    .from('email_connections')
    .select(`${PUBLIC_COLUMNS}, encrypted_refresh_token`)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnEmailConnectionWithToken');
  if (!data) return null;
  return {
    ...rowToEmailConnection(data),
    encryptedRefreshToken: data.encrypted_refresh_token,
  };
}

export async function updateOwnEmailConnectionAfterSync(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { lastSyncedAt: string; status?: 'ACTIVE' | 'ERROR' },
): Promise<void> {
  const { error } = await supabase
    .from('email_connections')
    .update({
      last_synced_at: input.lastSyncedAt,
      ...(input.status ? { status: input.status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  assertNoError(error, 'updateOwnEmailConnectionAfterSync');
}

/** Plain delete — cascades to email_signals via the FK's `on delete cascade`. Token revocation
 * at Google happens in the route handler *before* this is called; this function is pure
 * persistence and never talks to Google itself. */
export async function deleteOwnEmailConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('email_connections').delete().eq('user_id', userId);
  assertNoError(error, 'deleteOwnEmailConnection');
}
