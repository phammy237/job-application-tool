import { NextResponse } from 'next/server';
import {
  getGithubAccessToken,
  getOwnGithubConnection,
  listOwnGithubSyncRuns,
} from '@career-os/database';
import { GithubClient, syncGithubRepositories } from '@career-os/myos';
import { getCurrentUser } from '../../../../../lib/auth';
import { createGithubSyncStore } from '../../../../../lib/myos-github-store';
import { generateCandidatesForSelectedRepos } from '../../../../../lib/myos/extract-after-sync';
import { createClient } from '../../../../../lib/supabase/server';
import { createAdminClient } from '../../../../../lib/supabase/admin';

export const maxDuration = 60;

/** A RUNNING run younger than this blocks a new one (per-user mutex). */
const SYNC_LOCK_MS = 10 * 60 * 1000;

/**
 * Runs one GitHub sync for the signed-in user. No request body: the stored connection is the only
 * input. Mutex: if the user's latest sync run is RUNNING and started < 10 minutes ago → 409. The
 * check-then-insert is not atomic (documented trade-off in docs/myos/GITHUB_INGESTION.md); the
 * sync itself is idempotent, so a lost race costs duplicate API calls, never duplicate data.
 * The 10-minute expiry means a crashed run cannot lock the user out.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const connection = await getOwnGithubConnection(supabase, user.id);
  if (!connection) {
    return NextResponse.json({ error: 'No GitHub connection found' }, { status: 404 });
  }

  const [latest] = await listOwnGithubSyncRuns(supabase, user.id, 1);
  if (
    latest &&
    latest.status === 'RUNNING' &&
    Date.now() - Date.parse(latest.startedAt) < SYNC_LOCK_MS
  ) {
    return NextResponse.json(
      { error: 'A GitHub sync is already running' },
      { status: 409 },
    );
  }

  let token: string | null = null;
  if (connection.hasToken) {
    try {
      token = await getGithubAccessToken(createAdminClient(), user.id);
    } catch {
      return NextResponse.json(
        { error: 'Stored GitHub token could not be read; reconnect GitHub' },
        { status: 409 },
      );
    }
  }

  try {
    const result = await syncGithubRepositories({
      store: createGithubSyncStore(supabase),
      client: new GithubClient({ token }),
      userId: user.id,
      login: connection.githubLogin,
    });
    // Additive: derive PENDING candidates (deterministic, no LLM) for selected repos. A failure
    // here must never fail the sync, and nothing but a generic message is logged.
    try {
      await generateCandidatesForSelectedRepos(supabase, user.id);
    } catch {
      console.warn('[career-os] candidate generation after GitHub sync failed');
    }
    return NextResponse.json({
      runId: result.runId,
      status: result.status,
      stats: result.stats,
      error: result.error,
    });
  } catch (error) {
    console.error('[career-os] GitHub sync failed', (error as Error)?.name);
    return NextResponse.json({ error: 'GitHub sync failed' }, { status: 502 });
  }
}
