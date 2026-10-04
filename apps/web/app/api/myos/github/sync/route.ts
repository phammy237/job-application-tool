import { NextResponse } from 'next/server';
import {
  getGithubAccessToken,
  getOwnGithubConnection,
  listOwnGithubSyncRuns,
} from '@career-os/database';
import { GithubClient, syncGithubRepositories } from '@career-os/myos';
import { getCurrentUser } from '../../../../../lib/auth';
import {
  createGithubSyncStore,
  recordGithubConnectionSyncOutcome,
} from '../../../../../lib/myos-github-store';
import { generateCandidatesForSelectedRepos } from '../../../../../lib/myos/extract-after-sync';
import { createClient } from '../../../../../lib/supabase/server';
import { createAdminClient } from '../../../../../lib/supabase/admin';

export const maxDuration = 60;

/** A RUNNING run younger than this blocks a new one (per-user mutex). */
const SYNC_LOCK_MS = 10 * 60 * 1000;
/** Minimum gap between the starts of two syncs for one user. */
const SYNC_COOLDOWN_MS = 60 * 1000;
/** Token-less (username-only) syncs: 1 per 10 minutes per user. */
const TOKENLESS_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * Token-less requests all share this server's unauthenticated GitHub quota (60 req/h per IP), so a
 * per-process semaphore bounds concurrent token-less syncs. It is per process (serverless
 * instances do not share it); the per-user cooldown above is the durable limit.
 */
const MAX_CONCURRENT_TOKENLESS = 1;
let tokenlessInFlight = 0;

function tooMany(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    },
  );
}

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

  // Cooldown on the start of the previous run (any outcome).
  if (latest) {
    const sinceMs = Date.now() - Date.parse(latest.startedAt);
    const cooldown = connection.hasToken ? SYNC_COOLDOWN_MS : TOKENLESS_COOLDOWN_MS;
    if (Number.isFinite(sinceMs) && sinceMs >= 0 && sinceMs < cooldown) {
      return tooMany(
        connection.hasToken
          ? 'GitHub sync was run very recently; wait a minute and try again'
          : 'Username-only syncs are limited to one per 10 minutes; connect with a token for more',
        (cooldown - sinceMs) / 1000,
      );
    }
  }
  if (!connection.hasToken && tokenlessInFlight >= MAX_CONCURRENT_TOKENLESS) {
    return tooMany('Too many username-only syncs are running; try again shortly', 30);
  }

  // Ingestion writes (VERIFIED evidence, GITHUB_* sources, repo rows) and token reads are
  // service-role only; userId comes from the session and every query filters by it.
  const admin = createAdminClient();
  let token: string | null = null;
  if (connection.hasToken) {
    try {
      token = await getGithubAccessToken(admin, user.id);
    } catch {
      return NextResponse.json(
        { error: 'Stored GitHub token could not be read; reconnect GitHub' },
        { status: 409 },
      );
    }
  }

  const tokenless = !connection.hasToken;
  if (tokenless) tokenlessInFlight++;
  try {
    const result = await syncGithubRepositories({
      store: createGithubSyncStore(admin),
      client: new GithubClient({ token }),
      userId: user.id,
      login: connection.githubLogin,
      // Only a token validated as belonging to the login proves ownership (checked at connect).
      ownershipVerified: connection.hasToken && token !== null,
    });
    try {
      await recordGithubConnectionSyncOutcome(admin, user.id, {
        status: result.status,
        error: result.error,
      });
    } catch {
      console.warn('[career-os] could not record GitHub connection sync outcome');
    }
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
    try {
      await recordGithubConnectionSyncOutcome(admin, user.id, {
        status: 'FAILED',
        error: 'GitHub sync failed',
      });
    } catch {
      // best effort
    }
    return NextResponse.json({ error: 'GitHub sync failed' }, { status: 502 });
  } finally {
    if (tokenless) tokenlessInFlight--;
  }
}
