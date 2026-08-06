import { resumeSchema, type Resume } from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['resumes']['Row'];

function rowToResume(row: Row): Resume {
  return resumeSchema.parse({
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
 * Query layer only — résumé upload UI and extraction pipeline are out of scope for Phase 1
 * (see docs/IMPLEMENTATION_PLAN.md). Kept here so the table has a typed access path as soon
 * as it's needed, and so `applications.resume_id` can be resolved to a label.
 */
export async function listOwnResumes(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Resume[]> {
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnResumes');
  return (data ?? []).map(rowToResume);
}
