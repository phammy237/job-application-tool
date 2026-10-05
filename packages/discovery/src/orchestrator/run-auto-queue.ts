import {
  getJobCatalogEntryById,
  getJobCatalogFeatures,
  getJobSource,
  listOwnApplicationsPendingAutoQueueReview,
  listOwnAutoQueueCandidateMatchScores,
  listOwnTrackedJobCatalogIds,
  markOwnApplicationAutoQueued,
  startApplicationFromCatalogJob,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { buildCatalogJobHandoffPayload } from '../build-catalog-snapshot';
import {
  AUTO_QUEUE_MIN_MATCH_SCORE,
  MAX_AUTO_QUEUE_CANDIDATES_PER_RUN,
  MAX_AUTO_QUEUED_PER_USER_PER_RUN,
  MAX_PENDING_AUTO_QUEUE_PER_USER,
} from '../config';

export interface RunAutoQueueOptions {
  maxCandidates?: number;
  maxNewQueuedPerUser?: number;
  maxPendingBacklog?: number;
}

export interface RunAutoQueueUserResult {
  userId: string;
  candidatesConsidered: number;
  alreadyTracked: number;
  queued: number;
  skippedAtBacklogCap: boolean;
}

/**
 * Auto Mode's per-user orchestrator (D9 Phase A, migration 0047) — called by
 * `/api/cron/auto-queue` once per opted-in user (`listUsersEligibleForAutoQueue`). `supabase`
 * MUST be the service-role admin client: `startApplicationFromCatalogJob` needs it regardless
 * (job_snapshots has no `authenticated` INSERT policy, same reason the manual D6 handoff route
 * needs it), and since the admin client bypasses RLS entirely, every query below is explicitly
 * scoped to `userId` as the *only* enforcement — CLAUDE.md "RLS is the backstop, not the only
 * check."
 *
 * Deliberately reuses the exact D6 handoff primitives (`buildCatalogJobHandoffPayload`,
 * `startApplicationFromCatalogJob`) a manual "Start application" click already uses — zero new
 * RPC, zero new scoring system, and `status` stays structurally hardcoded to `'SAVED'` inside
 * migration 0032's function regardless of this new caller. The only new behavior is *which*
 * candidates get handed to that same pipeline, and tagging the resulting events `AUTO_QUEUE`
 * instead of the default `'USER'`.
 */
export async function runAutoQueueForUser(
  supabase: CareerOsSupabaseClient,
  userId: string,
  options: RunAutoQueueOptions = {},
): Promise<RunAutoQueueUserResult> {
  const maxCandidates = options.maxCandidates ?? MAX_AUTO_QUEUE_CANDIDATES_PER_RUN;
  const maxNewQueuedPerUser = options.maxNewQueuedPerUser ?? MAX_AUTO_QUEUED_PER_USER_PER_RUN;
  const maxPendingBacklog = options.maxPendingBacklog ?? MAX_PENDING_AUTO_QUEUE_PER_USER;

  // Backlog cap first, before spending anything else — a user who never opens their review queue
  // must never get it flooded tick after tick.
  const pending = await listOwnApplicationsPendingAutoQueueReview(supabase, userId);
  if (pending.length >= maxPendingBacklog) {
    return {
      userId,
      candidatesConsidered: 0,
      alreadyTracked: 0,
      queued: 0,
      skippedAtBacklogCap: true,
    };
  }

  const candidates = await listOwnAutoQueueCandidateMatchScores(supabase, userId, {
    minMatchScore: AUTO_QUEUE_MIN_MATCH_SCORE,
    limit: maxCandidates,
  });
  if (candidates.length === 0) {
    return { userId, candidatesConsidered: 0, alreadyTracked: 0, queued: 0, skippedAtBacklogCap: false };
  }

  const candidateIds = candidates.map((candidate) => candidate.jobCatalogId);
  const tracked = await listOwnTrackedJobCatalogIds(supabase, userId, candidateIds);
  const untracked = candidates.filter((candidate) => !tracked.has(candidate.jobCatalogId));
  const toQueue = untracked.slice(0, maxNewQueuedPerUser);

  let queued = 0;
  for (const candidate of toQueue) {
    try {
      const job = await getJobCatalogEntryById(supabase, candidate.jobCatalogId);
      // The catalog row can vanish between scoring and this run in principle (never observed,
      // but never assumed impossible either) — skip rather than throw, same "one bad row never
      // aborts the rest" posture as every other per-candidate step here.
      if (!job) continue;

      const [features, jobSource] = await Promise.all([
        getJobCatalogFeatures(supabase, candidate.jobCatalogId),
        getJobSource(supabase, job.sourceId),
      ]);
      const payload = await buildCatalogJobHandoffPayload({
        job,
        features,
        jobSource,
        matchScore: candidate,
      });

      const result = await startApplicationFromCatalogJob(supabase, userId, {
        jobCatalogId: candidate.jobCatalogId,
        ...payload,
        eventSource: 'AUTO_QUEUE',
      });

      // `created: false` means the user or extension already has a real relationship with this
      // posting (Tier 1/2 convergence) — never relabel that application as "pending your review."
      if (result.created) {
        await markOwnApplicationAutoQueued(supabase, userId, result.applicationId);
        queued += 1;
      }
    } catch (error) {
      console.error(
        '[career-os] Auto Mode queueing failed for one candidate',
        userId,
        candidate.jobCatalogId,
        error,
      );
    }
  }

  return {
    userId,
    candidatesConsidered: candidates.length,
    alreadyTracked: tracked.size,
    queued,
    skippedAtBacklogCap: false,
  };
}
