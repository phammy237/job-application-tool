import {
  resumeVersionSchema,
  type ResumeSnapshotFormat,
  type ResumeVersion,
  type StructuredResumeV1,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['resume_versions']['Row'];

function rowToResumeVersion(row: Row): ResumeVersion {
  return resumeVersionSchema.parse({
    id: row.id,
    userId: row.user_id,
    resumeId: row.resume_id,
    versionNumber: row.version_number,
    displayName: row.display_name,
    snapshotFormat: row.snapshot_format,
    snapshotPayload: row.snapshot_payload,
    createdAt: row.created_at,
  });
}

/**
 * Every version across every one of the user's resumes, in one query — the application detail
 * page's "select a working résumé version" control needs the whole set (grouped by resume
 * client-side), and fetching it per-resume would be one query per resume (N+1) for what is
 * expected to stay a small, single-user-scale dataset either way.
 */
export async function listOwnResumeVersions(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<ResumeVersion[]> {
  const { data, error } = await supabase
    .from('resume_versions')
    .select('*')
    .eq('user_id', userId)
    .order('resume_id', { ascending: true })
    .order('version_number', { ascending: false });
  assertNoError(error, 'listOwnResumeVersions');
  return (data ?? []).map(rowToResumeVersion);
}

export async function listOwnResumeVersionsForResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  resumeId: string,
): Promise<ResumeVersion[]> {
  const { data, error } = await supabase
    .from('resume_versions')
    .select('*')
    .eq('user_id', userId)
    .eq('resume_id', resumeId)
    .order('version_number', { ascending: false });
  assertNoError(error, 'listOwnResumeVersionsForResume');
  return (data ?? []).map(rowToResumeVersion);
}

export async function getOwnResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<ResumeVersion | null> {
  const { data, error } = await supabase
    .from('resume_versions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnResumeVersion');
  return data ? rowToResumeVersion(data) : null;
}

/**
 * Batched version-count lookup for a list of resumes in one query (avoids one query per row on
 * the /resumes list page, same posture as `countOwnApplicationLinksForContacts`). A resume with
 * zero versions is absent from the map.
 */
export async function countOwnResumeVersionsForResumes(
  supabase: CareerOsSupabaseClient,
  userId: string,
  resumeIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (resumeIds.length === 0) return result;

  const { data, error } = await supabase
    .from('resume_versions')
    .select('resume_id')
    .eq('user_id', userId)
    .in('resume_id', resumeIds);
  assertNoError(error, 'countOwnResumeVersionsForResumes');

  for (const row of data ?? []) {
    result.set(row.resume_id, (result.get(row.resume_id) ?? 0) + 1);
  }
  return result;
}

/**
 * Creates a new immutable version of a resume via the `create_resume_version` RPC (migration
 * 0020) — the one atomic, concurrency-safe path for version creation; `version_number` is always
 * server-computed, never client-supplied (docs/IMPLEMENTATION_PLAN.md "Phase 7A" §9/§34). The RPC
 * is service-role-only (same posture as `mark_application_applied`), so callers must pass an
 * admin client, with `userId` derived from the verified server-side session — never a
 * client-supplied field.
 *
 * `snapshotFormat`/`snapshotPayload` default to the RPC's own SQL-side defaults (`METADATA_ONLY`/
 * `null`) when omitted — unchanged Phase 7A behavior. Phase 7C callers pass `STRUCTURED_V1` and
 * an already-`structuredResumeV1Schema`-validated payload; this function does not re-validate it
 * (the caller — the Studio's save action — validates before calling this), it only forwards it,
 * same posture as every other query-layer function that trusts its caller for content shape and
 * only re-derives ownership/identity itself.
 */
export async function createOwnResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: {
    resumeId: string;
    displayName: string;
    snapshotFormat?: ResumeSnapshotFormat;
    snapshotPayload?: StructuredResumeV1;
  },
): Promise<ResumeVersion> {
  // Note: create_resume_version returns a single public.resume_versions row (not SETOF/TABLE),
  // so — unlike mark_application_applied's `.rpc(...).single()` — PostgREST already hands back
  // the row object directly; no `.single()` call here.
  const { data, error } = await supabase.rpc('create_resume_version', {
    p_user_id: userId,
    p_resume_id: input.resumeId,
    p_display_name: input.displayName,
    ...(input.snapshotFormat ? { p_snapshot_format: input.snapshotFormat } : {}),
    ...(input.snapshotPayload
      ? { p_snapshot_payload: input.snapshotPayload as unknown as Json }
      : {}),
  });
  return rowToResumeVersion(unwrapRow(data, error, 'createOwnResumeVersion'));
}

/**
 * Deletion is allowed for any version the user owns — the one invariant that actually matters
 * ("a version used in a real submission must never be deletable") is enforced structurally by
 * `submission_packets.resume_version_id`'s `on delete restrict` FK (migration 0021), which
 * surfaces as a Postgres foreign-key-violation error; this function turns that into a friendly
 * message rather than letting the raw error reach the UI.
 */
export async function deleteOwnResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('resume_versions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    if (error.code === '23503') {
      throw new DatabaseError(
        'This resume version was used in a submitted application and cannot be deleted.',
        error,
      );
    }
    throw new DatabaseError(`deleteOwnResumeVersion: ${error.message}`, error);
  }
}
