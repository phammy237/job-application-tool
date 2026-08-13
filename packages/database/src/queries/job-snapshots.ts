import { jobSnapshotSchema, type JobSnapshot } from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['job_snapshots']['Row'];

function rowToJobSnapshot(row: Row): JobSnapshot {
  return jobSnapshotSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceJobId: row.source_job_id,
    company: row.company,
    title: row.title,
    location: row.location,
    employmentType: row.employment_type,
    sourceUrl: row.source_url,
    externalId: row.external_id,
    description: row.description,
    requiredQualifications: row.required_qualifications ?? [],
    preferredQualifications: row.preferred_qualifications ?? [],
    responsibilities: row.responsibilities ?? [],
    skills: row.skills ?? [],
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    locations: row.locations ?? [],
    workMode: row.work_mode,
    remoteLocationRestrictions: row.remote_location_restrictions,
    workAuthorizationLanguage: row.work_authorization_language,
    sourceType: row.source_type,
    contentFingerprint: row.content_fingerprint,
    contentTruncated: row.content_truncated,
    truncatedFields: row.truncated_fields ?? [],
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  });
}

/**
 * Read-only — job_snapshots has no insert/update query function in this package by design. Every
 * write goes through upsertApplicationWithSnapshot (applications.ts), which calls the
 * service-role-only upsert_application_with_snapshot RPC; this table's RLS grants `authenticated`
 * select only (supabase/migrations/0010_...sql), so this is the one legitimate read path — used
 * by the application detail page via the caller's own session-scoped client.
 */
export async function getOwnJobSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<JobSnapshot | null> {
  const { data, error } = await supabase
    .from('job_snapshots')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnJobSnapshot');
  return data ? rowToJobSnapshot(data) : null;
}
