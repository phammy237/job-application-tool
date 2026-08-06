import {
  applicationSchema,
  type Application,
  type ApplicationInput,
  type ApplicationStatus,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { recordApplicationEvent } from './application-events';

type Row = Database['public']['Tables']['applications']['Row'];

function rowToApplication(row: Row): Application {
  return applicationSchema.parse({
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    resumeId: row.resume_id,
    company: row.company,
    title: row.title,
    status: row.status,
    notes: row.notes,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface ApplicationFilters {
  status?: ApplicationStatus;
  company?: string;
  search?: string;
}

export async function listOwnApplications(
  supabase: CareerOsSupabaseClient,
  userId: string,
  filters: ApplicationFilters = {},
): Promise<Application[]> {
  let query = supabase.from('applications').select('*').eq('user_id', userId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.company) query = query.ilike('company', `%${filters.company}%`);
  if (filters.search) {
    query = query.or(`company.ilike.%${filters.search}%,title.ilike.%${filters.search}%`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  assertNoError(error, 'listOwnApplications');
  return (data ?? []).map(rowToApplication);
}

export async function getOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Application | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnApplication');
  return data ? rowToApplication(data) : null;
}

/** Creates an application and records the initial SAVED status as a timeline event. */
export async function createOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ApplicationInput,
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .insert({
      user_id: userId,
      company: input.company,
      title: input.title,
      status: input.status ?? 'SAVED',
      notes: input.notes ?? null,
      resume_id: input.resumeId ?? null,
      applied_at: input.appliedAt ?? null,
    })
    .select('*')
    .single();
  const application = rowToApplication(unwrapRow(data, error, 'createOwnApplication'));

  await recordApplicationEvent(supabase, userId, {
    applicationId: application.id,
    eventType: 'STATUS_CHANGE',
    fromStatus: null,
    toStatus: application.status,
    source: 'USER',
  });

  return application;
}

/** Updates non-status fields. Use changeOwnApplicationStatus for status transitions. */
export async function updateOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: {
    company?: string;
    title?: string;
    notes?: string | null;
    resumeId?: string | null;
  },
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .update({
      company: update.company,
      title: update.title,
      notes: update.notes,
      resume_id: update.resumeId,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToApplication(unwrapRow(data, error, 'updateOwnApplication'));
}

/**
 * Manual status change from the dashboard. Always source: 'USER' — this function is not
 * used by the (future) Gmail sync path, which records its own events directly so it can
 * attach an email_signal_id. See docs/DATA_MODEL.md "application_events".
 */
export async function changeOwnApplicationStatus(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
): Promise<Application> {
  const current = await getOwnApplication(supabase, userId, id);
  if (!current) {
    throw new Error('Application not found or not owned by this user.');
  }

  const { data, error } = await supabase
    .from('applications')
    .update({ status: toStatus })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  const application = rowToApplication(
    unwrapRow(data, error, 'changeOwnApplicationStatus'),
  );

  await recordApplicationEvent(supabase, userId, {
    applicationId: id,
    eventType: 'STATUS_CHANGE',
    fromStatus: current.status,
    toStatus,
    source: 'USER',
  });

  return application;
}

export async function deleteOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnApplication');
}
