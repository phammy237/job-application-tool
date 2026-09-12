import {
  getOwnApplication,
  listOwnRelevantStatusChangeEventsForApplication,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  deriveNextAction,
  type Application,
  type ApplicationEvent,
  type NextAction,
} from '@career-os/shared';

/**
 * Re-derives "what is this application's current deterministic next action?" from scratch —
 * shared by both `generate-follow-up-draft.ts` and `generate-interview-prep.ts` as their own
 * server-side eligibility gate (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3C": "Server recomputes/
 * validates the current deterministic action"). Deliberately re-fetches and re-derives here
 * rather than trusting a value the caller (apps/web's route handlers) already computed — this
 * package must never take the deterministic decision as an untrusted input, only as something it
 * independently confirms.
 *
 * The reduction below (most recent STATUS_CHANGE event, excluding a reverted one or the
 * SYSTEM-sourced revert-bookkeeping event) is the same one `apps/web/lib/dashboard.ts`'s
 * `buildLastRelevantStatusActivityMap` performs — intentionally re-expressed here rather than
 * imported, since `packages/ai` cannot depend on `apps/web` (the dependency only ever runs the
 * other way). `listOwnRelevantStatusChangeEventsForApplication` already applies both exclusions
 * at the database layer; the check below is this codebase's established defensive
 * double-filtering posture, not new logic.
 */
export async function deriveEligibleNextAction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<{ application: Application; nextAction: NextAction } | null> {
  const application = await getOwnApplication(supabase, userId, applicationId);
  if (!application) {
    return null;
  }

  const events = await listOwnRelevantStatusChangeEventsForApplication(
    supabase,
    userId,
    applicationId,
  );
  const lastRelevantStatusActivityAt = mostRecentRelevantTimestamp(events);

  const nextAction = deriveNextAction({
    status: application.status,
    unresolvedFields: application.unresolvedFields,
    appliedAt: application.appliedAt,
    lastRelevantStatusActivityAt,
    now: new Date().toISOString(),
  });

  return { application, nextAction };
}

function mostRecentRelevantTimestamp(events: ApplicationEvent[]): string | null {
  for (const event of events) {
    if (event.eventType !== 'STATUS_CHANGE') continue;
    if (event.revertedAt) continue;
    if (event.source === 'SYSTEM') continue;
    return event.createdAt;
  }
  return null;
}
