import { createHash, randomBytes } from 'node:crypto';
import { portfolioSettingsSchema, type PortfolioSettings } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['portfolio_settings']['Row'];

export const PORTFOLIO_API_KEY_PREFIX = 'cos_pub_';

/** Maps a row to the domain type. The api_key_hash is reduced to a boolean and never returned. */
function rowToSettings(row: Row): PortfolioSettings {
  return portfolioSettingsSchema.parse({
    userId: row.user_id,
    enabled: row.enabled,
    hasApiKey: row.api_key_hash !== null && row.api_key_hash !== '',
    displayName: row.display_name,
    headline: row.headline,
  });
}

export function hashPortfolioApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export async function getOwnPortfolioSettings(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<PortfolioSettings | null> {
  const { data, error } = await supabase
    .from('portfolio_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnPortfolioSettings');
  return data ? rowToSettings(data) : null;
}

/** Never touches api_key_hash (the column is absent from the payload, so it is preserved). */
export async function upsertOwnPortfolioSettings(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { enabled: boolean; displayName: string | null; headline: string | null },
): Promise<PortfolioSettings> {
  const { data, error } = await supabase
    .from('portfolio_settings')
    .upsert(
      {
        user_id: userId,
        enabled: input.enabled,
        display_name: input.displayName,
        headline: input.headline,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  return rowToSettings(unwrapRow(data, error, 'upsertOwnPortfolioSettings'));
}

/**
 * Generates a fresh key (32 random bytes, 'cos_pub_' + base64url), stores ONLY its SHA-256 hex
 * hash (replacing any previous key, which stops working immediately) and returns the plaintext.
 * The plaintext is shown to the user exactly once and is unrecoverable afterwards.
 */
export async function rotateOwnPortfolioApiKey(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<string> {
  const key = PORTFOLIO_API_KEY_PREFIX + randomBytes(32).toString('base64url');
  const { error } = await supabase
    .from('portfolio_settings')
    .upsert({ user_id: userId, api_key_hash: hashPortfolioApiKey(key) }, { onConflict: 'user_id' });
  assertNoError(error, 'rotateOwnPortfolioApiKey');
  return key;
}

/**
 * SERVER / ADMIN ONLY (service role; the caller is unauthenticated, so there is no user_id to
 * filter by — the key hash IS the credential). Resolves to a user id only when portfolio export
 * is explicitly enabled; otherwise null.
 */
export async function getUserIdForPortfolioApiKey(
  adminSupabase: CareerOsSupabaseClient,
  key: string,
): Promise<string | null> {
  if (!key.startsWith(PORTFOLIO_API_KEY_PREFIX)) return null;
  const { data, error } = await adminSupabase
    .from('portfolio_settings')
    .select('user_id')
    .eq('api_key_hash', hashPortfolioApiKey(key))
    .eq('enabled', true)
    .maybeSingle();
  assertNoError(error, 'getUserIdForPortfolioApiKey');
  return data ? data.user_id : null;
}
