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

/**
 * Thin adapter binding the pure sync engine's store interface to the database query layer. All
 * functions take `userId` from the verified session (never from request data); the underlying
 * queries filter by it explicitly.
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
  };
}
