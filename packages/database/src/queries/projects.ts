import {
  projectSchema,
  type Project,
  type ProjectInput,
  type ProjectUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['projects']['Row'];

function rowToProject(row: Row): Project {
  return projectSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceFactId: row.source_fact_id,
    name: row.name,
    description: row.description,
    role: row.role,
    startDate: row.start_date,
    endDate: row.end_date,
    url: row.url,
    tags: row.tags ?? [],
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
    visibleOnPublicProfile: row.visible_on_public_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOwnProjects(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false, nullsFirst: false });
  assertNoError(error, 'listOwnProjects');
  return (data ?? []).map(rowToProject);
}

export async function createOwnProject(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ProjectInput,
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      source_fact_id: input.sourceFactId ?? null,
      name: input.name,
      description: input.description ?? null,
      role: input.role ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      url: input.url ?? null,
      tags: input.tags ?? [],
      user_approved: input.userApproved ?? false,
      approved_for_applications: input.approvedForApplications ?? false,
      visible_on_public_profile: input.visibleOnPublicProfile ?? false,
    })
    .select('*')
    .single();
  return rowToProject(unwrapRow(data, error, 'createOwnProject'));
}

export async function updateOwnProject(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: ProjectUpdate,
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update({
      name: update.name,
      description: update.description,
      role: update.role,
      start_date: update.startDate,
      end_date: update.endDate,
      url: update.url,
      tags: update.tags,
      user_approved: update.userApproved,
      approved_for_applications: update.approvedForApplications,
      visible_on_public_profile: update.visibleOnPublicProfile,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToProject(unwrapRow(data, error, 'updateOwnProject'));
}

export async function deleteOwnProject(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnProject');
}
