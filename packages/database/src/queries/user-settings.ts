import { userSettingsSchema, type UserSettings } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

export interface AiUsageCheck {
  allowed: boolean;
  aiRequestsThisPeriod: number;
  aiRequestLimit: number;
  aiRequestPeriodStartedAt: string;
}

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

/**
 * Flips the per-user Gmail opt-in flag — set true by the OAuth callback on a successful connect
 * (connecting Gmail *is* the opt-in action, per docs/USER_FLOWS.md §7; there is no separate
 * settings toggle a user flips before connecting) and reset to false on disconnect. Distinct
 * from the global `gmail_integration_enabled` feature flag, which is a kill switch independent
 * of any single user's choice.
 */
export async function updateOwnGmailIntegrationEnabled(
  supabase: CareerOsSupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await getOrCreateOwnUserSettings(supabase, userId);
  const { error } = await supabase
    .from('user_settings')
    .update({ gmail_integration_enabled: enabled })
    .eq('user_id', userId);
  assertNoError(error, 'updateOwnGmailIntegrationEnabled');
}

/**
 * Atomically checks-and-increments the caller's AI request usage via the
 * increment_ai_request_usage Postgres function (supabase/migrations/
 * 0004_increment_ai_request_usage.sql), which row-locks the user_settings row for the
 * duration of the check — closing the read-then-write race a plain select-then-update from
 * application code would have. Only increments when `allowed` comes back true, so a blocked
 * request is never double-counted. See docs/AI_GROUNDING.md §7 and
 * docs/SECURITY_AND_PRIVACY.md's rate-limit enforcement risk.
 */
export async function incrementOwnAiRequestUsage(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<AiUsageCheck> {
  const { data, error } = await supabase
    .rpc('increment_ai_request_usage', { p_user_id: userId })
    .single();
  const row = unwrapRow(data, error, 'incrementOwnAiRequestUsage');
  return {
    allowed: row.allowed,
    aiRequestsThisPeriod: row.ai_requests_this_period,
    aiRequestLimit: row.ai_request_limit,
    aiRequestPeriodStartedAt: row.ai_request_period_started_at,
  };
}

/**
 * Gives back the one unit `incrementOwnAiRequestUsage` pre-emptively reserved
 * (supabase/migrations/0033_ai_request_usage_accounting_fix.sql) — called by every
 * packages/ai generator specifically and only when the provider call itself fails
 * (`outcome.kind === 'provider_error'`: an auth/network/5xx failure, never a real model
 * response), never on accepted/rejected/refusal. A provider_error means Claude was never
 * meaningfully reached, so it shouldn't permanently spend the user's shared quota — this is
 * the fix for the real incident where 50 consecutive authentication failures from the Gmail
 * email-classification path silently exhausted a real account's entire quota with zero
 * legitimate AI usage. Best-effort by design (never let a telemetry/refund step fail the
 * caller's already-decided response) — every call site wraps this in `.catch()`. Floors at 0
 * (never goes negative) so this is safe even if called more than once for the same reserved
 * unit.
 */
export async function decrementOwnAiRequestUsage(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc('decrement_ai_request_usage', { p_user_id: userId });
  assertNoError(error, 'decrementOwnAiRequestUsage');
}
