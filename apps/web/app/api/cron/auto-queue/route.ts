import { NextResponse } from 'next/server';
import { listUsersEligibleForAutoQueue } from '@career-os/database';
import {
  MAX_CONCURRENT_AUTO_QUEUE_USERS,
  MAX_USERS_PER_AUTO_QUEUE_RUN,
  runAutoQueueForUser,
} from '@career-os/discovery';
import { mapWithConcurrency } from '../../../../lib/map-with-concurrency';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * Scheduled Auto Mode auto-queueing (migration 0047/vercel.json's cron entry, D9 Phase A) —
 * structural copy of `/api/cron/gmail-background-sync`'s auth/bounded-concurrency/per-user-
 * isolation shape. Reachable only by Vercel's own cron invoker: `Authorization: Bearer
 * ${CRON_SECRET}` must match exactly, including against an authenticated end user's own session —
 * this route takes no session/cookie auth at all.
 *
 * Runs entirely on the service-role client. Per CLAUDE.md ("RLS is the backstop, not the only
 * check"), `runAutoQueueForUser` explicitly scopes every read/write to the one `userId` it's given
 * — `listUsersEligibleForAutoQueue` is the one intentional exception (packages/database's own doc
 * comment on it), returning nothing beyond a bare list of ids for this loop to process.
 *
 * Bounded to MAX_USERS_PER_AUTO_QUEUE_RUN per tick and to MAX_AUTO_QUEUED_PER_USER_PER_RUN per
 * user per tick (packages/discovery/src/config.ts) — a larger backlog is simply picked up by the
 * next scheduled tick. One user's failure is caught and recorded per-user; it never aborts the
 * rest of the run. Users are processed with bounded concurrency (MAX_CONCURRENT_AUTO_QUEUE_USERS)
 * for the same reason the Gmail cron route is: each user's queueing is fully independent, so
 * running them one at a time only adds wall-clock time with no correctness benefit, but running
 * all MAX_USERS_PER_AUTO_QUEUE_RUN at once would needlessly spike concurrent load for no further
 * win, since this route is already bounded by maxDuration.
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
  const eligibleUserIds = (await listUsersEligibleForAutoQueue(adminClient)).slice(
    0,
    MAX_USERS_PER_AUTO_QUEUE_RUN,
  );

  type UserQueueResult =
    | {
        userId: string;
        status: 'queued';
        candidatesConsidered: number;
        alreadyTracked: number;
        queued: number;
        skippedAtBacklogCap: boolean;
      }
    | { userId: string; status: 'error'; message: string };

  const results = await mapWithConcurrency(
    eligibleUserIds,
    MAX_CONCURRENT_AUTO_QUEUE_USERS,
    async (userId): Promise<UserQueueResult> => {
      try {
        const result = await runAutoQueueForUser(adminClient, userId);
        return { ...result, status: 'queued' };
      } catch (error) {
        console.error('[career-os] Auto Mode queueing failed for a user', userId, error);
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
