import {
  educationSchema,
  type Education,
  type EducationInput,
  type EducationUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['education']['Row'];

function rowToEducation(row: Row): Education {
  return educationSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceFactId: row.source_fact_id,
    school: row.school,
    degree: row.degree,
    fieldOfStudy: row.field_of_study,
    startDate: row.start_date,
    graduationDate: row.graduation_date,
    gpa: row.gpa,
    honors: row.honors ?? [],
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
    visibleOnPublicProfile: row.visible_on_public_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOwnEducation(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Education[]> {
  const { data, error } = await supabase
    .from('education')
    .select('*')
    .eq('user_id', userId)
    .order('graduation_date', { ascending: false, nullsFirst: false });
  assertNoError(error, 'listOwnEducation');
  return (data ?? []).map(rowToEducation);
}

export async function createOwnEducation(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: EducationInput,
): Promise<Education> {
  const { data, error } = await supabase
    .from('education')
    .insert({
      user_id: userId,
      source_fact_id: input.sourceFactId ?? null,
      school: input.school,
      degree: input.degree ?? null,
      field_of_study: input.fieldOfStudy ?? null,
      start_date: input.startDate ?? null,
      graduation_date: input.graduationDate ?? null,
      gpa: input.gpa ?? null,
      honors: input.honors ?? [],
      user_approved: input.userApproved ?? false,
      approved_for_applications: input.approvedForApplications ?? false,
      visible_on_public_profile: input.visibleOnPublicProfile ?? false,
    })
    .select('*')
    .single();
  return rowToEducation(unwrapRow(data, error, 'createOwnEducation'));
}

export async function updateOwnEducation(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: EducationUpdate,
): Promise<Education> {
  const { data, error } = await supabase
    .from('education')
    .update({
      school: update.school,
      degree: update.degree,
      field_of_study: update.fieldOfStudy,
      start_date: update.startDate,
      graduation_date: update.graduationDate,
      gpa: update.gpa,
      honors: update.honors,
      user_approved: update.userApproved,
      approved_for_applications: update.approvedForApplications,
      visible_on_public_profile: update.visibleOnPublicProfile,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToEducation(unwrapRow(data, error, 'updateOwnEducation'));
}

export async function deleteOwnEducation(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('education')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnEducation');
}
