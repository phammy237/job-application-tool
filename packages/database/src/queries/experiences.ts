import {
  experienceSchema,
  type Experience,
  type ExperienceInput,
  type ExperienceUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['experiences']['Row'];

function rowToExperience(row: Row): Experience {
  return experienceSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceFactId: row.source_fact_id,
    company: row.company,
    title: row.title,
    location: row.location,
    employmentType: row.employment_type,
    startDate: row.start_date,
    endDate: row.end_date,
    description: row.description,
    tags: row.tags ?? [],
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
    visibleOnPublicProfile: row.visible_on_public_profile,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOwnExperiences(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Experience[]> {
  const { data, error } = await supabase
    .from('experiences')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false, nullsFirst: false });
  assertNoError(error, 'listOwnExperiences');
  return (data ?? []).map(rowToExperience);
}

export async function createOwnExperience(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ExperienceInput,
): Promise<Experience> {
  const { data, error } = await supabase
    .from('experiences')
    .insert({
      user_id: userId,
      source_fact_id: input.sourceFactId ?? null,
      company: input.company,
      title: input.title,
      location: input.location ?? null,
      employment_type: input.employmentType ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      user_approved: input.userApproved ?? false,
      approved_for_applications: input.approvedForApplications ?? false,
      visible_on_public_profile: input.visibleOnPublicProfile ?? false,
      display_order: input.displayOrder ?? 0,
    })
    .select('*')
    .single();
  return rowToExperience(unwrapRow(data, error, 'createOwnExperience'));
}

export async function updateOwnExperience(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: ExperienceUpdate,
): Promise<Experience> {
  const { data, error } = await supabase
    .from('experiences')
    .update({
      company: update.company,
      title: update.title,
      location: update.location,
      employment_type: update.employmentType,
      start_date: update.startDate,
      end_date: update.endDate,
      description: update.description,
      tags: update.tags,
      user_approved: update.userApproved,
      approved_for_applications: update.approvedForApplications,
      visible_on_public_profile: update.visibleOnPublicProfile,
      display_order: update.displayOrder,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToExperience(unwrapRow(data, error, 'updateOwnExperience'));
}

export async function deleteOwnExperience(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('experiences')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnExperience');
}
