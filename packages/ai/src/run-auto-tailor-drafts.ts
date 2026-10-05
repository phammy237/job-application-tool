import {
  createOwnPendingResumeTailoringDraft,
  hasOwnPendingResumeTailoringDraft,
  listOwnApplicationsEligibleForAutoTailorDraft,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { generateResumeTailoringPlan } from './generate-resume-tailoring-plan';
import { MAX_AUTO_TAILOR_DRAFTS_PER_USER_PER_RUN } from './config';

export interface RunAutoTailorDraftsOptions {
  maxDraftsPerUserPerRun?: number;
}

export interface RunAutoTailorDraftsUserResult {
  userId: string;
  eligible: number;
  drafted: number;
  skippedExisting: number;
  rateLimited: boolean;
}

/**
 * Auto Mode's auto-tailoring orchestrator (D9 Phase B, migration 0048) — called by
 * `/api/cron/auto-tailor-drafts` once per opted-in user. `supabase` MUST be the service-role
 * admin client: `generateResumeTailoringPlan`'s own quota reserve/refund RPCs are service-role
 * only (same posture `packages/email`'s `runGmailSync` already documents for its own `aiClient`
 * parameter), and every "Own"-prefixed read/write it and this orchestrator make is still
 * explicitly scoped to the one `userId` given — CLAUDE.md "RLS is the backstop, not the only
 * check," since the admin client bypasses RLS entirely.
 *
 * Candidates are this user's own Auto Mode-queued, KEPT applications that already have a
 * working résumé attached (`listOwnApplicationsEligibleForAutoTailorDraft`) — never every
 * application the user has, and never one Career OS chose a résumé for on the user's behalf.
 * One already-pending draft per application is the ceiling (`hasOwnPendingResumeTailoringDraft`
 * skip) — a user who hasn't reviewed yesterday's draft never gets it silently replaced by
 * today's. `generateResumeTailoringPlan` is called with no `researchMode` (defaults to
 * `JOB_ONLY`) — Phase B stays orthogonal to the separate, explicit company-research feature.
 *
 * Stops early for this user the moment a call comes back `rate_limited` — every further call
 * would just fail the same way, so there's no reason to keep spending wall-clock time finding
 * out again. Every other non-`ok` status (no working résumé, unsupported format, missing job
 * snapshot, provider error, validation failure) is logged and skipped, never thrown — one
 * application's ineligibility or failure never aborts the rest of this user's batch.
 */
export async function runAutoTailorDraftsForUser(
  supabase: CareerOsSupabaseClient,
  userId: string,
  options: RunAutoTailorDraftsOptions = {},
): Promise<RunAutoTailorDraftsUserResult> {
  const maxDraftsPerUserPerRun =
    options.maxDraftsPerUserPerRun ?? MAX_AUTO_TAILOR_DRAFTS_PER_USER_PER_RUN;

  const eligibleApplications = await listOwnApplicationsEligibleForAutoTailorDraft(
    supabase,
    userId,
  );

  let drafted = 0;
  let skippedExisting = 0;
  let rateLimited = false;

  for (const application of eligibleApplications) {
    if (drafted >= maxDraftsPerUserPerRun) break;

    try {
      const alreadyPending = await hasOwnPendingResumeTailoringDraft(
        supabase,
        userId,
        application.id,
      );
      if (alreadyPending) {
        skippedExisting += 1;
        continue;
      }

      const result = await generateResumeTailoringPlan(supabase, userId, {
        applicationId: application.id,
      });

      if (result.status === 'rate_limited') {
        rateLimited = true;
        break;
      }
      if (result.status !== 'ok') {
        console.error(
          '[career-os] Auto Mode résumé-tailoring draft skipped for one application',
          userId,
          application.id,
          result.status,
        );
        continue;
      }

      await createOwnPendingResumeTailoringDraft(supabase, userId, application.id, result.proposal);
      drafted += 1;
    } catch (error) {
      console.error(
        '[career-os] Auto Mode résumé-tailoring draft failed for one application',
        userId,
        application.id,
        error,
      );
    }
  }

  return {
    userId,
    eligible: eligibleApplications.length,
    drafted,
    skippedExisting,
    rateLimited,
  };
}
