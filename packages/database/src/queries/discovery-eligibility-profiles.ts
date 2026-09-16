import {
  discoveryEligibilityProfileSchema,
  type DiscoveryEligibilityProfile,
  type DiscoveryEligibilityProfileUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['discovery_eligibility_profiles']['Row'];

function rowToProfile(row: Row): DiscoveryEligibilityProfile {
  return discoveryEligibilityProfileSchema.parse({
    userId: row.user_id,
    currentlyAuthorizedToWork: row.currently_authorized_to_work,
    requiresSponsorshipNow: row.requires_sponsorship_now,
    requiresSponsorshipFuture: row.requires_sponsorship_future,
    isUsCitizen: row.is_us_citizen,
    hasActiveSecurityClearance: row.has_active_security_clearance,
    eligibleToObtainSecurityClearance: row.eligible_to_obtain_security_clearance,
    graduationYear: row.graduation_year,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Same get-or-create safe-fallback pattern as `getOrCreateOwnScoringProfile`/
 * `getOrCreateOwnUserSettings` — every field defaults to null (unanswered), never a guessed
 * value (docs/JOB_DISCOVERY.md "Eligibility profile"). */
export async function getOrCreateOwnEligibilityProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<DiscoveryEligibilityProfile> {
  const { data, error } = await supabase
    .from('discovery_eligibility_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOrCreateOwnEligibilityProfile (select)');
  if (data) return rowToProfile(data);

  const { data: created, error: insertError } = await supabase
    .from('discovery_eligibility_profiles')
    .insert({ user_id: userId })
    .select('*')
    .single();
  return rowToProfile(unwrapRow(created, insertError, 'getOrCreateOwnEligibilityProfile (insert)'));
}

export async function updateOwnEligibilityProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
  update: DiscoveryEligibilityProfileUpdate,
): Promise<DiscoveryEligibilityProfile> {
  await getOrCreateOwnEligibilityProfile(supabase, userId);

  const payload: Database['public']['Tables']['discovery_eligibility_profiles']['Update'] = {};
  if (update.currentlyAuthorizedToWork !== undefined) {
    payload.currently_authorized_to_work = update.currentlyAuthorizedToWork;
  }
  if (update.requiresSponsorshipNow !== undefined) {
    payload.requires_sponsorship_now = update.requiresSponsorshipNow;
  }
  if (update.requiresSponsorshipFuture !== undefined) {
    payload.requires_sponsorship_future = update.requiresSponsorshipFuture;
  }
  if (update.isUsCitizen !== undefined) payload.is_us_citizen = update.isUsCitizen;
  if (update.hasActiveSecurityClearance !== undefined) {
    payload.has_active_security_clearance = update.hasActiveSecurityClearance;
  }
  if (update.eligibleToObtainSecurityClearance !== undefined) {
    payload.eligible_to_obtain_security_clearance = update.eligibleToObtainSecurityClearance;
  }
  if (update.graduationYear !== undefined) payload.graduation_year = update.graduationYear;

  const { data, error } = await supabase
    .from('discovery_eligibility_profiles')
    .update(payload)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToProfile(unwrapRow(data, error, 'updateOwnEligibilityProfile'));
}
