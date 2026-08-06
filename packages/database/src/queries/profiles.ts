import { profileSchema, type Profile, type ProfileUpdate } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

function rowToProfile(row: ProfileRow): Profile {
  return profileSchema.parse({
    userId: row.user_id,
    fullName: row.full_name,
    headline: row.headline,
    email: row.email,
    phone: row.phone,
    location: row.location,
    workAuthorization: row.work_authorization,
    relocationPreference: row.relocation_preference,
    links: row.links ?? {},
    publicSlug: row.public_slug,
    visibleOnPublicProfile: row.visible_on_public_profile,
    onboardingCompletedAt: row.onboarding_completed_at,
  });
}

/**
 * Fetches the caller's own profile. `userId` must come from the verified server-side
 * session (see apps/web/lib/supabase/server.ts) — never from client input. Filtering by
 * user_id here is defense-in-depth alongside RLS, per CLAUDE.md.
 */
export async function getOwnProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnProfile');
  return data ? rowToProfile(data) : null;
}

export async function upsertOwnProfile(
  supabase: CareerOsSupabaseClient,
  userId: string,
  update: ProfileUpdate,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        full_name: update.fullName,
        headline: update.headline,
        email: update.email,
        phone: update.phone,
        location: update.location,
        work_authorization: update.workAuthorization,
        relocation_preference: update.relocationPreference,
        links: update.links,
        visible_on_public_profile: update.visibleOnPublicProfile,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  return rowToProfile(unwrapRow(data, error, 'upsertOwnProfile'));
}
