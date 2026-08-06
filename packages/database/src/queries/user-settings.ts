import { userSettingsSchema, type UserSettings } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

function rowToUserSettings(row: {
  user_id: string;
  gmail_integration_enabled: boolean;
  ai_requests_this_period: number;
  ai_request_period_started_at: string;
  ai_request_limit: number;
  theme: string;
}): UserSettings {
  return userSettingsSchema.parse({
    userId: row.user_id,
    gmailIntegrationEnabled: row.gmail_integration_enabled,
    aiRequestsThisPeriod: row.ai_requests_this_period,
    aiRequestPeriodStartedAt: row.ai_request_period_started_at,
    aiRequestLimit: row.ai_request_limit,
    theme: row.theme,
  });
}

/**
 * Returns the caller's settings, creating the default row on first access — every account
 * gets one via the Phase 1 signup flow, but this is a safe fallback for any account created
 * before that wiring existed (e.g. directly via Supabase Studio during local dev).
 */
export async function getOrCreateOwnUserSettings(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOrCreateOwnUserSettings (select)');
  if (data) return rowToUserSettings(data);

  const { data: created, error: insertError } = await supabase
    .from('user_settings')
    .insert({ user_id: userId })
    .select('*')
    .single();
  return rowToUserSettings(
    unwrapRow(created, insertError, 'getOrCreateOwnUserSettings (insert)'),
  );
}
