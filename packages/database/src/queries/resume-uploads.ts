import { resumeUploadSchema, type ResumeUpload } from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['resume_uploads']['Row'];

function rowToResumeUpload(row: Row): ResumeUpload {
  return resumeUploadSchema.parse({
    id: row.id,
    userId: row.user_id,
    filePath: row.file_path,
    fileName: row.file_name,
    label: row.label,
    isPrimary: row.is_primary,
    extractionStatus: row.extraction_status,
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Query layer only — résumé upload UI and extraction pipeline are out of scope for this phase
 * (see docs/IMPLEMENTATION_PLAN.md). Kept here so the table has a typed access path as soon as
 * it's needed, and so legacy `applications.resume_id`/`candidate_facts.source_resume_id` values
 * can be resolved to a label. Renamed from `resumes`/`listOwnResumes` in migration 0020 (Phase
 * 7A) to free that name for the new logical résumé-identity model — see `./resumes.ts` and
 * `./resume-versions.ts` for that.
 */
export async function listOwnResumeUploads(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<ResumeUpload[]> {
  const { data, error } = await supabase
    .from('resume_uploads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnResumeUploads');
  return (data ?? []).map(rowToResumeUpload);
}
