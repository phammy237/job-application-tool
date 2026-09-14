import {
  resumeSchema,
  type CreateResumeInput,
  type Resume,
  type UpdateResumeInput,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['resumes']['Row'];

function rowToResume(row: Row): Resume {
  return resumeSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    parentResumeId: row.parent_resume_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * `public.resumes` (migration 0020, Phase 7A) — logical résumé identity. See
 * `packages/shared/src/schemas/resume.ts` for what this table does and does not represent, and
 * `./resume-versions.ts` for the immutable version history that belongs to each row here.
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

export async function getOwnResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Resume | null> {
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnResume');
  return data ? rowToResume(data) : null;
}

/**
 * Creates a logical resume. Ordinary RLS-scoped insert — the invariants that matter (at most one
 * MASTER per user, a TAILORED resume's parent must be a MASTER owned by the same user) are
 * database-enforced (migration 0020's partial unique index and
 * `enforce_resume_parent_is_master` trigger), not re-implemented here; this function only turns
 * the resulting Postgres errors into friendly ones for the two cases a user is actually likely to
 * hit through the UI.
 */
export async function createOwnResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreateResumeInput,
): Promise<Resume> {
  const { data, error } = await supabase
    .from('resumes')
    .insert({
      user_id: userId,
      name: input.name,
      kind: input.kind,
      parent_resume_id: input.parentResumeId ?? null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DatabaseError(
        'You already have a master resume — rename or delete it before creating another.',
        error,
      );
    }
    throw new DatabaseError(`createOwnResume: ${error.message}`, error);
  }
  if (!data) {
    throw new DatabaseError('createOwnResume: expected a row but got null');
  }
  return rowToResume(data);
}

export async function updateOwnResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  input: UpdateResumeInput,
): Promise<Resume> {
  const { data, error } = await supabase
    .from('resumes')
    .update({ name: input.name })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToResume(unwrapRow(data, error, 'updateOwnResume'));
}

/**
 * Cascades to this resume's own `resume_versions` rows at the database level (migration 0020,
 * `on delete cascade`) — but that cascade is itself blocked (the whole delete fails) if any of
 * those versions was ever frozen into a submission packet (migration 0021's `on delete restrict`
 * on `submission_packets.resume_version_id`). Surfaced here as a friendly error rather than a raw
 * foreign-key-violation message — see docs/IMPLEMENTATION_PLAN.md "Phase 7A" §25.
 */
export async function deleteOwnResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('resumes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    if (error.code === '23503') {
      throw new DatabaseError(
        'This resume has a version that was used in a submitted application and cannot be ' +
          'deleted.',
        error,
      );
    }
    throw new DatabaseError(`deleteOwnResume: ${error.message}`, error);
  }
}
