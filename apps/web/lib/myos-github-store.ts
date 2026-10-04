import 'server-only';
import {
  finishOwnGithubSyncRun,
  listOwnGithubRepositories,
  markOwnGithubRepositorySyncError,
  startOwnGithubSyncRun,
  upsertGithubRepositorySnapshot,
  upsertOwnEvidenceBySource,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import type { GithubSyncStore } from '@career-os/myos';

const RENAMEABLE_SOURCE_TYPES = ['GITHUB_REPO', 'GITHUB_README', 'GITHUB_PR'];

/**
 * Thin adapter binding the pure sync engine's store interface to the database query layer.
 *
 * `supabase` MUST be the service-role client (`createAdminClient()`): database triggers only allow
 * the service role to write VERIFIED evidence, GITHUB_* source types and github_repositories rows.
 * Because the service role bypasses RLS, every call takes `userId` from the verified session
 * (never request data) and the underlying queries filter by it explicitly.
 */
export function createGithubSyncStore(supabase: CareerOsSupabaseClient): GithubSyncStore {
  return {
    listRepositories: (userId) => listOwnGithubRepositories(supabase, userId),
    upsertRepositorySnapshot: async (userId, snapshot) => {
      await upsertGithubRepositorySnapshot(supabase, userId, snapshot);
    },
    markRepositorySyncError: (userId, repoRowId, message) =>
      markOwnGithubRepositorySyncError(supabase, userId, repoRowId, message),
    startSyncRun: async (userId) => {
      const run = await startOwnGithubSyncRun(supabase, userId);
      return { id: run.id };
    },
    finishSyncRun: async (userId, runId, result) => {
      await finishOwnGithubSyncRun(supabase, userId, runId, result);
    },
    upsertEvidenceBySource: async (userId, input) => {
      const evidence = await upsertOwnEvidenceBySource(supabase, userId, input);
      // Insert sets created_at = updated_at (same transaction timestamp); any update bumps updated_at.
      return {
        id: evidence.id,
        created: Date.parse(evidence.createdAt) === Date.parse(evidence.updatedAt),
      };
    },
    renameRepositoryEvidence: (userId, oldFullName, newFullName) =>
      renameGithubEvidenceRefs(supabase, userId, oldFullName, newFullName),
  };
}

/**
 * Re-keys GitHub evidence after a repo rename (same github_repo_id, new full_name) so the next
 * upsert updates the existing rows instead of creating duplicates. A row whose new ref already
 * exists (unique violation) is left alone.
 */
export async function renameGithubEvidenceRefs(
  admin: CareerOsSupabaseClient,
  userId: string,
  oldFullName: string,
  newFullName: string,
): Promise<void> {
  if (oldFullName === newFullName) return;
  const { data, error } = await admin
    .from('myos_evidence')
    .select('id, source_ref')
    .eq('user_id', userId)
    .in('source_type', RENAMEABLE_SOURCE_TYPES)
    .or(`source_ref.eq."${oldFullName}",source_ref.like."${escapeLike(oldFullName)}#%"`);
  if (error) throw new Error('renameGithubEvidenceRefs: select failed');
  for (const row of data ?? []) {
    const ref = row.source_ref;
    if (ref === null) continue;
    let next: string;
    if (ref === oldFullName) next = newFullName;
    else if (ref.startsWith(`${oldFullName}#`))
      next = newFullName + ref.slice(oldFullName.length);
    else continue;
    const { error: upErr } = await admin
      .from('myos_evidence')
      .update({ source_ref: next })
      .eq('id', row.id)
      .eq('user_id', userId);
    if (upErr && upErr.code !== '23505') {
      throw new Error('renameGithubEvidenceRefs: update failed');
    }
  }
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Records the outcome of a sync on the connection (service-role client, explicit user filter).
 * `last_synced_at` is only advanced when the run was not FAILED.
 */
export async function recordGithubConnectionSyncOutcome(
  admin: CareerOsSupabaseClient,
  userId: string,
  outcome: { status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; error: string | null },
): Promise<void> {
  const failed = outcome.status === 'FAILED';
  const { error } = await admin
    .from('github_connections')
    .update({
      status: failed ? 'ERROR' : 'CONNECTED',
      last_error: outcome.error ? outcome.error.slice(0, 500) : null,
      ...(failed ? {} : { last_synced_at: new Date().toISOString() }),
    })
    .eq('user_id', userId);
  if (error) throw new Error('recordGithubConnectionSyncOutcome failed');
}
