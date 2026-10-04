import type {
  GithubConnection,
  GithubRepoSnapshot,
  GithubRepository,
  GithubSyncRun,
} from '@career-os/shared';
import { decryptRefreshToken, encryptRefreshToken } from '../crypto/token-encryption';
import { assertNoError, unwrapRow } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  rowToGithubConnection,
  rowToGithubRepository,
  rowToGithubSyncRun,
  sanitizeDbText,
} from './myos-mappers';

// --------------------------------------------------------------------------------------------
// Connection (no token material ever flows through these functions)
// --------------------------------------------------------------------------------------------

export async function getOwnGithubConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<GithubConnection | null> {
  const { data, error } = await supabase
    .from('github_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnGithubConnection');
  return data ? rowToGithubConnection(data) : null;
}

export async function upsertOwnGithubConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { login: string; hasToken: boolean; githubUserId?: number | null },
): Promise<GithubConnection> {
  const { data, error } = await supabase
    .from('github_connections')
    .upsert(
      {
        user_id: userId,
        github_login: input.login,
        has_token: input.hasToken,
        status: 'CONNECTED',
        last_error: null,
        ...(input.githubUserId !== undefined
          ? { github_user_id: input.githubUserId }
          : {}),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  return rowToGithubConnection(unwrapRow(data, error, 'upsertOwnGithubConnection'));
}

/** Deleting the connection cascades to github_credentials (FK on delete cascade). */
export async function deleteOwnGithubConnection(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('github_connections')
    .delete()
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnGithubConnection');
}

// --------------------------------------------------------------------------------------------
// Credentials — SERVER / ADMIN ONLY.
// github_credentials has RLS enabled with zero policies and all grants revoked from
// anon/authenticated, so these only work with the service-role client. They filter by user_id
// explicitly because the service role bypasses RLS. Never call from client code or return the
// result to a client.
// --------------------------------------------------------------------------------------------

/**
 * Encrypts (AES-256-GCM, TOKEN_ENCRYPTION_KEY) and stores the token, then flags the connection
 * has_token = true. The github_connections row must already exist (FK).
 */
export async function saveGithubAccessToken(
  adminSupabase: CareerOsSupabaseClient,
  userId: string,
  plaintext: string,
): Promise<void> {
  const { error } = await adminSupabase
    .from('github_credentials')
    .upsert(
      { user_id: userId, encrypted_access_token: encryptRefreshToken(plaintext) },
      { onConflict: 'user_id' },
    );
  assertNoError(error, 'saveGithubAccessToken');
  const { error: flagError } = await adminSupabase
    .from('github_connections')
    .update({ has_token: true })
    .eq('user_id', userId);
  assertNoError(flagError, 'saveGithubAccessToken.flag');
}

/** Returns the decrypted token or null when none is stored. Throws on tamper/wrong key. */
export async function getGithubAccessToken(
  adminSupabase: CareerOsSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await adminSupabase
    .from('github_credentials')
    .select('encrypted_access_token')
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getGithubAccessToken');
  return data ? decryptRefreshToken(data.encrypted_access_token) : null;
}

// --------------------------------------------------------------------------------------------
// Repositories
// --------------------------------------------------------------------------------------------

export async function listOwnGithubRepositories(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<GithubRepository[]> {
  const { data, error } = await supabase
    .from('github_repositories')
    .select('*')
    .eq('user_id', userId)
    .order('pushed_at', { ascending: false, nullsFirst: false });
  assertNoError(error, 'listOwnGithubRepositories');
  return (data ?? []).map(rowToGithubRepository);
}

export async function getOwnGithubRepository(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<GithubRepository | null> {
  const { data, error } = await supabase
    .from('github_repositories')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnGithubRepository');
  return data ? rowToGithubRepository(data) : null;
}

/**
 * SERVER-ONLY write path (migration 0060: end users cannot insert/update ingested columns).
 * Call with the service-role client and a session-derived userId.
 *
 * Idempotent on (user_id, github_repo_id). On re-sync only the snapshot-derived columns and
 * sync bookkeeping are written: `selected` and `project_id` are user decisions and are NEVER
 * reset (they are not even present in the update payload).
 */
export async function upsertGithubRepositorySnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  snapshot: GithubRepoSnapshot,
): Promise<GithubRepository> {
  const columns = {
    full_name: sanitizeDbText(snapshot.fullName),
    description: sanitizeDbText(snapshot.description),
    html_url: snapshot.htmlUrl,
    is_private: snapshot.isPrivate,
    is_fork: snapshot.isFork,
    is_archived: snapshot.isArchived,
    default_branch: snapshot.defaultBranch,
    primary_language: sanitizeDbText(snapshot.primaryLanguage),
    languages: snapshot.languages as Json,
    topics: snapshot.topics,
    stars: snapshot.stars,
    repo_created_at: snapshot.repoCreatedAt,
    pushed_at: snapshot.pushedAt,
    readme_excerpt: sanitizeDbText(snapshot.readmeExcerpt),
    readme_sha: snapshot.readmeSha,
    contributors: snapshot.contributors as Json,
    pr_count: snapshot.prCount,
    commit_count: snapshot.commitCount,
    etag: snapshot.etag,
    sync_status: 'SYNCED',
    sync_error: null,
    last_synced_at: new Date().toISOString(),
  };

  const { data: existing, error: findError } = await supabase
    .from('github_repositories')
    .select('id')
    .eq('user_id', userId)
    .eq('github_repo_id', snapshot.githubRepoId)
    .maybeSingle();
  assertNoError(findError, 'upsertGithubRepositorySnapshot.find');

  if (existing) {
    const { data, error } = await supabase
      .from('github_repositories')
      .update(columns)
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select('*')
      .single();
    return rowToGithubRepository(
      unwrapRow(data, error, 'upsertGithubRepositorySnapshot.update'),
    );
  }

  const { data, error } = await supabase
    .from('github_repositories')
    .insert({ user_id: userId, github_repo_id: snapshot.githubRepoId, ...columns })
    .select('*')
    .single();
  return rowToGithubRepository(
    unwrapRow(data, error, 'upsertGithubRepositorySnapshot.insert'),
  );
}

export async function setOwnGithubRepositorySelected(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  selected: boolean,
): Promise<GithubRepository> {
  const { data, error } = await supabase
    .from('github_repositories')
    .update({ selected })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToGithubRepository(unwrapRow(data, error, 'setOwnGithubRepositorySelected'));
}

export async function setOwnGithubRepositoryProject(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  projectId: string | null,
): Promise<GithubRepository> {
  const { data, error } = await supabase
    .from('github_repositories')
    .update({ project_id: projectId })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToGithubRepository(unwrapRow(data, error, 'setOwnGithubRepositoryProject'));
}

/**
 * Atomically links a repository to a project only if it has none yet
 * (update ... where project_id is null returning). Returns null when another request already
 * claimed it, so a double submit can never attach two projects.
 */
export async function claimOwnGithubRepositoryProject(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  projectId: string,
): Promise<GithubRepository | null> {
  const { data, error } = await supabase
    .from('github_repositories')
    .update({ project_id: projectId })
    .eq('id', id)
    .eq('user_id', userId)
    .is('project_id', null)
    .select('*')
    .maybeSingle();
  assertNoError(error, 'claimOwnGithubRepositoryProject');
  return data ? rowToGithubRepository(data) : null;
}

export async function markOwnGithubRepositorySyncError(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from('github_repositories')
    .update({ sync_status: 'ERROR', sync_error: message.slice(0, 500) })
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'markOwnGithubRepositorySyncError');
}

// --------------------------------------------------------------------------------------------
// Sync runs
// --------------------------------------------------------------------------------------------

export async function startOwnGithubSyncRun(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<GithubSyncRun> {
  const { data, error } = await supabase
    .from('github_sync_runs')
    .insert({ user_id: userId, status: 'RUNNING' })
    .select('*')
    .single();
  return rowToGithubSyncRun(unwrapRow(data, error, 'startOwnGithubSyncRun'));
}

export async function finishOwnGithubSyncRun(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  result: {
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
    stats?: Record<string, unknown>;
    error?: string | null;
  },
): Promise<GithubSyncRun> {
  const { data, error } = await supabase
    .from('github_sync_runs')
    .update({
      status: result.status,
      stats: (result.stats ?? {}) as Json,
      error: result.error ? result.error.slice(0, 1000) : null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToGithubSyncRun(unwrapRow(data, error, 'finishOwnGithubSyncRun'));
}

export async function listOwnGithubSyncRuns(
  supabase: CareerOsSupabaseClient,
  userId: string,
  limit = 10,
): Promise<GithubSyncRun[]> {
  const { data, error } = await supabase
    .from('github_sync_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  assertNoError(error, 'listOwnGithubSyncRuns');
  return (data ?? []).map(rowToGithubSyncRun);
}
