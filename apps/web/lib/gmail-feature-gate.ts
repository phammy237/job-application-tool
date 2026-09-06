import 'server-only';
import { getOrCreateOwnUserSettings, isFeatureEnabled } from '@career-os/database';
import { FEATURE_FLAG_KEYS } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '@career-os/database';

/**
 * The global `gmail_integration_enabled` feature flag alone — a kill switch independent of any
 * single user's opt-in state. This is the only check `/api/gmail/connect` and
 * `/api/gmail/callback` can use: connecting Gmail *is* how a user opts in
 * (docs/USER_FLOWS.md §7), so gating the connect flow on the per-user toggle as well would make
 * it impossible for anyone to ever opt in in the first place.
 */
export async function isGmailIntegrationGloballyEnabled(
  supabase: CareerOsSupabaseClient,
): Promise<boolean> {
  return isFeatureEnabled(supabase, FEATURE_FLAG_KEYS.GMAIL_INTEGRATION_ENABLED);
}

/**
 * Two-tier gate for every route that assumes a connection already exists (sync, disconnect,
 * confirm): the global flag above AND the caller's own `user_settings.gmail_integration_enabled`
 * opt-in, which the OAuth callback sets true on a successful connect and disconnect resets to
 * false.
 */
export async function isGmailSyncEnabledForUser(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<boolean> {
  const [globallyEnabled, settings] = await Promise.all([
    isGmailIntegrationGloballyEnabled(supabase),
    getOrCreateOwnUserSettings(supabase, userId),
  ]);
  return globallyEnabled && settings.gmailIntegrationEnabled;
}
