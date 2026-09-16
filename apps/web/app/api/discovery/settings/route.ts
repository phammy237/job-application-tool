import { NextResponse } from 'next/server';
import {
  getOrCreateOwnEligibilityProfile,
  getOrCreateOwnScoringProfile,
  updateOwnEligibilityProfile,
  updateOwnScoringProfile,
} from '@career-os/database';
import { rankJobsForUser } from '@career-os/discovery';
import { computeDiscoverySettingsChanges, discoverySettingsRequestSchema } from '@career-os/shared';
import { getCurrentUser } from '../../../../lib/auth';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { createClient } from '../../../../lib/supabase/server';

/** `rankJobsForUser` re-evaluates every ACTIVE job in the catalog (currently ~1,371) — bounds
 * worst-case request duration, same posture as `/api/gmail/sync`'s own `maxDuration`. Synchronous
 * request/response by design (docs/JOB_DISCOVERY.md "D5B" — "no queue system"): a save only ever
 * happens while the user has this page open and clicks Save, never unattended. */
export const maxDuration = 60;

interface RecomputeAttempted {
  attempted: true;
  succeeded: boolean;
  jobsConsidered?: number;
  jobsScored?: number;
  jobsExcludedByLocationPreference?: number;
}
interface RecomputeSkipped {
  attempted: false;
}

export interface DiscoverySettingsSaveResult {
  scoringChanged: boolean;
  eligibilityChanged: boolean;
  recompute: RecomputeAttempted | RecomputeSkipped;
  error?: string;
}

/**
 * `/settings/discovery`'s save endpoint (D5B). Not a server action: like `/api/gmail/sync`, this
 * needs to return a rich result (which profile changed, the actual recompute counts) a plain
 * server action doesn't model as naturally (see gmail-section.tsx's own doc comment for the same
 * reasoning applied there first).
 *
 * `userId` comes only from the verified session (`getCurrentUser`) — never the request body.
 * Reads/writes to `discovery_scoring_profiles`/`discovery_eligibility_profiles` use the ordinary
 * session-scoped client (standard 4-policy RLS already lets a user write their own row directly —
 * docs/DATA_MODEL.md). The recompute step is the one part of this request that needs the
 * service-role admin client: `user_job_match_scores` is select-only for `authenticated`
 * (docs/JOB_DISCOVERY.md "Persistence, versioning, and recomputation") — same posture as
 * `deleteAccount()` in settings/actions.ts, which uses the admin client for the one operation RLS
 * structurally can't allow an authenticated user to do to their own row, with the id still taken
 * only from the verified session.
 *
 * Explicit failure semantics (never a misleading partial state):
 *   - malformed body -> 400, nothing touched.
 *   - a no-op submission (nothing actually different from what's persisted) -> no writes, no
 *     recompute, reported as such.
 *   - a profile write fails -> 500, reports exactly which profile(s) did/didn't save, recompute
 *     never attempted (recomputing against a possibly-inconsistent partial write would be worse
 *     than not recomputing at all).
 *   - both profile writes succeed but the recompute step throws -> 502, `recompute.succeeded:
 *     false` — the saved preferences are real and will be used the next time ranking runs
 *     (manually retried from this page, or the next `discovery:rank`), but this response never
 *     claims jobs were re-ranked when they weren't.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = discoverySettingsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const [currentScoring, currentEligibility] = await Promise.all([
    getOrCreateOwnScoringProfile(supabase, user.id),
    getOrCreateOwnEligibilityProfile(supabase, user.id),
  ]);

  const { scoringChanged, eligibilityChanged } = computeDiscoverySettingsChanges(
    { scoring: currentScoring, eligibility: currentEligibility },
    parsed.data,
  );

  if (!scoringChanged && !eligibilityChanged) {
    return NextResponse.json({
      scoringChanged: false,
      eligibilityChanged: false,
      recompute: { attempted: false },
    } satisfies DiscoverySettingsSaveResult);
  }

  const saveErrors: string[] = [];
  if (scoringChanged) {
    try {
      await updateOwnScoringProfile(supabase, user.id, parsed.data.scoring);
    } catch (error) {
      console.error('[career-os] discovery scoring profile save failed', error);
      saveErrors.push('Could not save your scoring preferences.');
    }
  }
  if (eligibilityChanged) {
    try {
      await updateOwnEligibilityProfile(supabase, user.id, parsed.data.eligibility);
    } catch (error) {
      console.error('[career-os] discovery eligibility profile save failed', error);
      saveErrors.push('Could not save your eligibility preferences.');
    }
  }

  if (saveErrors.length > 0) {
    // Never attempt a recompute against a partially-saved state.
    return NextResponse.json(
      {
        scoringChanged,
        eligibilityChanged,
        recompute: { attempted: false },
        error: saveErrors.join(' '),
      } satisfies DiscoverySettingsSaveResult,
      { status: 500 },
    );
  }

  try {
    const admin = createAdminClient();
    const summary = await rankJobsForUser(admin, user.id);
    return NextResponse.json({
      scoringChanged,
      eligibilityChanged,
      recompute: {
        attempted: true,
        succeeded: true,
        jobsConsidered: summary.jobsConsidered,
        jobsScored: summary.jobsScored,
        jobsExcludedByLocationPreference: summary.jobsExcludedByLocationPreference,
      },
    } satisfies DiscoverySettingsSaveResult);
  } catch (error) {
    console.error('[career-os] discovery recompute failed', error);
    return NextResponse.json(
      {
        scoringChanged,
        eligibilityChanged,
        recompute: { attempted: true, succeeded: false },
        error:
          'Your preferences were saved, but re-ranking your jobs failed. Your existing rankings are unchanged — try saving again to retry re-ranking.',
      } satisfies DiscoverySettingsSaveResult,
      { status: 502 },
    );
  }
}
