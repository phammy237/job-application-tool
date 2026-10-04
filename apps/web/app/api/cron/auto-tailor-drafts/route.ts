import { NextResponse } from 'next/server';
import { listUsersEligibleForAutoQueue } from '@career-os/database';
import {
  MAX_CONCURRENT_AUTO_TAILOR_USERS,
  MAX_USERS_PER_AUTO_TAILOR_RUN,
  runAutoTailorDraftsForUser,
} from '@career-os/ai';
import { mapWithConcurrency } from '../../../../lib/map-with-concurrency';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * Scheduled Auto Mode auto-tailoring (migration 0048/vercel.json's cron entry, D9 Phase B) —
 * structural copy of `/api/cron/auto-queue`'s auth/bounded-concurrency/per-user-isolation shape.
 * Same `auto_mode_enabled` toggle as Phase A's queueing cron — there is no separate Phase B
 * opt-in; Auto Mode is one switch covering both "find and queue jobs" and "draft a tailored
 * résumé for the ones you kept."
 *
 * Unlike the queueing cron, this one makes real, billed Claude calls (through
 * `generateResumeTailoringPlan`, called by `runAutoTailorDraftsForUser`) — every call still
 * respects the per-user `ai_request_limit` exactly like a user's own live "Tailor resume for
 * this job" click would, and `runAutoTailorDraftsForUser` stops early for a user the moment it
 * sees `rate_limited` rather than keeps trying.
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
    MAX_USERS_PER_AUTO_TAILOR_RUN,
  );

  type UserDraftResult =
    | {
        userId: string;
        status: 'drafted';
        eligible: number;
        drafted: number;
        skippedExisting: number;
        rateLimited: boolean;
      }
    | { userId: string; status: 'error'; message: string };

  const results = await mapWithConcurrency(
    eligibleUserIds,
    MAX_CONCURRENT_AUTO_TAILOR_USERS,
    async (userId): Promise<UserDraftResult> => {
      try {
        const result = await runAutoTailorDraftsForUser(adminClient, userId);
        return { ...result, status: 'drafted' };
      } catch (error) {
        console.error('[career-os] Auto Mode résumé-tailoring drafting failed for a user', userId, error);
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
