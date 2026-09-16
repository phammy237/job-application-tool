import {
  discoveryScoringProfileSchema,
  type DiscoveryScoringProfile,
  type DiscoveryScoringProfileUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['discovery_scoring_profiles']['Row'];

function rowToProfile(row: Row): DiscoveryScoringProfile {
  return discoveryScoringProfileSchema.parse({
    userId: row.user_id,
    profileVersion: row.profile_version,
    preset: row.preset,
    criteriaWeights: row.criteria_weights,
    rolePreferences: row.role_preferences,
    seniorityPreferences: row.seniority_preferences,
    locationPreferences: row.location_preferences,
    workModePreferences: row.work_mode_preferences,
    employmentTypePreferences: row.employment_type_preferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Returns the caller's scoring profile, creating the default (BALANCED preset, DB-column
 * defaults — see migration 0030) row on first access, same "safe fallback" pattern as
 * `getOrCreateOwnUserSettings`. Works identically whether `supabase` is a session-scoped client
 * (a future D5 UI) or the service-role admin client (the D4 CLI, `userId` supplied explicitly) —
 * this function never trusts a client-supplied `userId` on its own; the caller derives it from a
 * verified session or an explicit CLI argument, never from request input.
 */
export async function getOrCreateOwnScoringProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<DiscoveryScoringProfile> {
  const { data, error } = await supabase
    .from('discovery_scoring_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOrCreateOwnScoringProfile (select)');
  if (data) return rowToProfile(data);

  const { data: created, error: insertError } = await supabase
    .from('discovery_scoring_profiles')
    .insert({ user_id: userId })
    .select('*')
    .single();
  return rowToProfile(unwrapRow(created, insertError, 'getOrCreateOwnScoringProfile (insert)'));
}

/** Full replace of the editable fields (never partial-merges a jsonb map — the caller/CLI always
 * supplies the complete intended map for each preference bucket, matching this repo's existing
 * "the caller owns the whole value" convention for jsonb columns). */
export async function updateOwnScoringProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
  update: DiscoveryScoringProfileUpdate,
): Promise<DiscoveryScoringProfile> {
  await getOrCreateOwnScoringProfile(supabase, userId);

  const payload: Database['public']['Tables']['discovery_scoring_profiles']['Update'] = {};
  if (update.preset !== undefined) payload.preset = update.preset;
  if (update.criteriaWeights !== undefined) payload.criteria_weights = update.criteriaWeights as Json;
  if (update.rolePreferences !== undefined) payload.role_preferences = update.rolePreferences as Json;
  if (update.seniorityPreferences !== undefined) {
    payload.seniority_preferences = update.seniorityPreferences as Json;
  }
  if (update.locationPreferences !== undefined) {
    payload.location_preferences = update.locationPreferences as Json;
  }
  if (update.workModePreferences !== undefined) {
    payload.work_mode_preferences = update.workModePreferences as Json;
  }
  if (update.employmentTypePreferences !== undefined) {
    payload.employment_type_preferences = update.employmentTypePreferences as Json;
  }

  const { data, error } = await supabase
    .from('discovery_scoring_profiles')
    .update(payload)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToProfile(unwrapRow(data, error, 'updateOwnScoringProfile'));
}

/** Every user who has ever had a scoring profile created — the bounded set `discovery:rank`
 * iterates by default when no `--user-id` is given (docs/JOB_DISCOVERY.md "Recomputation"). */
export async function listAllScoringProfiles(
  supabase: CareerOsSupabaseClient,
): Promise<DiscoveryScoringProfile[]> {
  const { data, error } = await supabase.from('discovery_scoring_profiles').select('*');
  assertNoError(error, 'listAllScoringProfiles');
  return (data ?? []).map(rowToProfile);
}
