import { assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * Every user eligible for the next Auto Mode cron run (migration 0047, D9 Phase A) — service-role
 * only, same "no hardcoded user, the bounded real set this product currently has" pattern as
 * `listUsersEligibleForBackgroundGmailSync`, intended to be called only by `/api/cron/auto-queue`
 * with the admin client.
 *
 * Unlike Gmail background tracking, Auto Mode has no external account/connection prerequisite —
 * it only ever reads this user's own already-computed `/discover` scores, so opting in
 * (`auto_mode_enabled = true`) is the complete eligibility condition.
 */
export async function listUsersEligibleForAutoQueue(
  supabase: CareerOsSupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('auto_mode_enabled', true);
  assertNoError(error, 'listUsersEligibleForAutoQueue');
  return (data ?? []).map((row) => row.user_id);
}
