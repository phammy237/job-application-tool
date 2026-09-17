import { resumeUploadSchema, type ResumeUpload } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
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
    contentHash: 'content_hash' in row ? row.content_hash : null,
    contentType: 'content_type' in row ? row.content_type : null,
    fileSizeBytes: 'file_size_bytes' in row ? row.file_size_bytes : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Query layer for the `resume_uploads` table (migration 0020, Phase 7A; extended by migration
 * 0034, Phase B, for Resume Import — see that migration's own comment for the full history).
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

/**
 * Dedup lookup (migration 0034's `resume_uploads_user_content_hash_key` partial unique index) —
 * a repeat upload of the identical file resolves to this existing row instead of writing a
 * duplicate file/row.
 */
export async function getOwnResumeUploadByContentHash(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contentHash: string,
): Promise<ResumeUpload | null> {
  const { data, error } = await supabase
    .from('resume_uploads')
    .select('*')
    .eq('user_id', userId)
    .eq('content_hash', contentHash)
    .maybeSingle();
  assertNoError(error, 'getOwnResumeUploadByContentHash');
  return data ? rowToResumeUpload(data) : null;
}

export interface CreateResumeUploadInput {
  filePath: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  contentHash: string;
}

/**
 * Creates the audit/dedup row for an uploaded file — never the extracted content itself
 * (docs/SECURITY_AND_PRIVACY.md "no raw resume text logging" — this table only ever tracks file
 * metadata). `extraction_status` starts PENDING; the analyze route updates it to COMPLETE/FAILED
 * once extraction actually runs, via `updateOwnResumeUploadExtractionStatus` below.
 */
export async function createOwnResumeUpload(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreateResumeUploadInput,
): Promise<ResumeUpload> {
  const { data, error } = await supabase
    .from('resume_uploads')
    .insert({
      user_id: userId,
      file_path: input.filePath,
      file_name: input.fileName,
      content_type: input.contentType,
      file_size_bytes: input.fileSizeBytes,
      content_hash: input.contentHash,
      extraction_status: 'PENDING',
    })
    .select('*')
    .single();
  return rowToResumeUpload(unwrapRow(data, error, 'createOwnResumeUpload'));
}

export async function updateOwnResumeUploadExtractionStatus(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  status: 'PROCESSING' | 'COMPLETE' | 'FAILED',
): Promise<void> {
  const { error } = await supabase
    .from('resume_uploads')
    .update({
      extraction_status: status,
      extracted_at: status === 'COMPLETE' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'updateOwnResumeUploadExtractionStatus');
}
