import { jobSchema, type Job, type JobInput } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['jobs']['Row'];

function rowToJob(row: Row): Job {
  return jobSchema.parse({
    id: row.id,
    userId: row.user_id,
    company: row.company,
    title: row.title,
    location: row.location,
    employmentType: row.employment_type,
    description: row.description,
    responsibilities: row.responsibilities ?? [],
    qualifications: row.qualifications ?? [],
    preferredQualifications: row.preferred_qualifications ?? [],
    skills: row.skills ?? [],
    sourceUrl: row.source_url,
    platformType: row.platform_type,
    rawExtraction: (row.raw_extraction as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Minimal Phase 1 shape — a manually-entered job stub an application can point at. Full
 * extraction (description, responsibilities, raw_extraction, platform_type) is populated by
 * the extension starting Phase 2; see docs/DATA_MODEL.md "jobs".
 */
export async function createOwnJob(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: Pick<JobInput, 'company' | 'title' | 'location'>,
): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      user_id: userId,
      company: input.company ?? null,
      title: input.title ?? null,
      location: input.location ?? null,
    })
    .select('*')
    .single();
  return rowToJob(unwrapRow(data, error, 'createOwnJob'));
}

export async function getOwnJob(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnJob');
  return data ? rowToJob(data) : null;
}
