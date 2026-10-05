import { NextResponse } from 'next/server';
import { listUsersEligibleForBackgroundGmailSync } from '@career-os/database';
import {
  MAX_CONCURRENT_BACKGROUND_SYNC_USERS,
  MAX_USERS_PER_BACKGROUND_SYNC_RUN,
  runGmailSync,
} from '@career-os/email';
import { mapWithConcurrency } from '../../../../lib/map-with-concurrency';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * Scheduled background Gmail auto-tracking (migration 0046/vercel.json's cron entry) — the one
 * genuinely unattended entry point in this codebase; every other Gmail sync path requires a
 * signed-in user to have the app open in that moment (docs/EMAIL_INTEGRATION.md §1). Reachable
 * only by Vercel's own cron invoker, authenticated the standard documented way: Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` on cron-triggered requests when that env var is set, so
 * a request lacking the exact matching header is rejected outright, including from an
 * authenticated end user's own session — this route takes no session/cookie auth at all.
 *
 * Runs entirely on the service-role client. Per CLAUDE.md ("RLS is the backstop, not the only
 * check"), every read/write below still passes an explicit, independently-derived `user_id` into
 * each "Own"-prefixed query function — listUsersEligibleForBackgroundGmailSync is the one
 * intentional exception (packages/database's own doc comment on it), and it never returns
 * anything beyond a bare list of user ids for this loop to then process one at a time, each call
 * scoped to that one id.
 *
 * Bounded to MAX_USERS_PER_BACKGROUND_SYNC_RUN per tick and to MAX_MESSAGES_PER_SYNC per user per
 * tick (packages/email/src/config.ts) — a larger backlog is simply picked up by the next
 * scheduled tick, never by this invocation running longer to catch up. One user's failure
 * (expired token, Gmail API error, …) is caught and recorded per-user; it never aborts the rest
 * of the run.
 *
 * Users are synced with bounded concurrency (MAX_CONCURRENT_BACKGROUND_SYNC_USERS), not fully
 * sequential and not fully parallel: each user's sync is independent (unlike the message loop
 * inside runGmailSync, nothing here is shared mutable state across users), so running them one at
 * a time only adds wall-clock time with no correctness benefit — but running all
 * MAX_USERS_PER_BACKGROUND_SYNC_RUN at once would needlessly spike concurrent Gmail API and
 * Claude-quota load for no further wall-clock win, since this route is already bounded by
 * maxDuration rather than by how many users fit in parallel.
 *
 * 60s — the same ceiling the manual sync route uses, and the safe ceiling on Vercel's Hobby
 * plan; raise this (Pro plan supports up to 300s) only alongside lowering
 * MAX_USERS_PER_BACKGROUND_SYNC_RUN/MAX_MESSAGES_PER_SYNC if real run times need the room.
 */
export const maxDuration = 60;

function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const eligibleUserIds = (
    await listUsersEligibleForBackgroundGmailSync(adminClient)
  ).slice(0, MAX_USERS_PER_BACKGROUND_SYNC_RUN);

  type UserSyncResult = {
    userId: string;
    status: 'synced' | 'no_connection' | 'error';
    processed?: number;
    autoApplied?: number;
    autoCreated?: number;
    needsConfirmation?: number;
    skipped?: number;
    message?: string;
  };

  const results = await mapWithConcurrency(
    eligibleUserIds,
    MAX_CONCURRENT_BACKGROUND_SYNC_USERS,
    async (userId): Promise<UserSyncResult> => {
      try {
        const result = await runGmailSync(adminClient, userId, adminClient, {
          allowAutoCreate: true,
        });
        if (result.status === 'no_connection') {
          return { userId, status: 'no_connection' };
        }
        return {
          userId,
          status: 'synced',
          processed: result.processed,
          autoApplied: result.autoApplied,
          autoCreated: result.autoCreated,
          needsConfirmation: result.needsConfirmation,
          skipped: result.skipped,
        };
      } catch (error) {
        console.error('[career-os] background Gmail sync failed for a user', userId, error);
        return {
          userId,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  return NextResponse.json({ usersProcessed: results.length, results });
}
