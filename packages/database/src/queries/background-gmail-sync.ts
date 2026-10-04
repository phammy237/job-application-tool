import { assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * Every user eligible for the next background Gmail sync cron run (migration 0046) — service-
 * role only, same "no hardcoded user, the bounded real set this product currently has" pattern
 * as listAllScoringProfiles (packages/database's discovery-scoring-profiles.ts), intended to be
 * called only by /api/cron/gmail-background-sync with the admin client.
 *
 * Eligible means ALL of: the user opted into background tracking specifically
 * (background_gmail_tracking_enabled), Gmail is connected at all (gmail_integration_enabled —
 * the base manual-sync opt-in, which background tracking is layered on top of, never a
 * substitute for), and their email_connections row is still ACTIVE (not DISCONNECTED/ERROR — a
 * broken connection is surfaced on /settings for the user to fix, never retried silently by the
 * background job).
 */
export async function listUsersEligibleForBackgroundGmailSync(
  supabase: CareerOsSupabaseClient,
): Promise<string[]> {
  const { data: settingsRows, error: settingsError } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('background_gmail_tracking_enabled', true)
    .eq('gmail_integration_enabled', true);
  assertNoError(settingsError, 'listUsersEligibleForBackgroundGmailSync (user_settings)');
  const candidateUserIds = (settingsRows ?? []).map((row) => row.user_id);
  if (candidateUserIds.length === 0) return [];

  const { data: connectionRows, error: connectionError } = await supabase
    .from('email_connections')
    .select('user_id')
    .in('user_id', candidateUserIds)
    .eq('status', 'ACTIVE');
  assertNoError(connectionError, 'listUsersEligibleForBackgroundGmailSync (email_connections)');
  return [...new Set((connectionRows ?? []).map((row) => row.user_id))];
}
