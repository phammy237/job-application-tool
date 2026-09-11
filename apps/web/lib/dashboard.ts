import {
  compareByAttention,
  deriveNextAction,
  type Application,
  type ApplicationEvent,
  type NextAction,
} from '@career-os/shared';

/**
 * Server-side data assembly for the dashboard (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2H") —
 * deliberately separate from the pure rule engine in packages/shared (Phase 5C.1H: "1. server-
 * side data assembly 2. pure next-action rules 3. UI formatting/rendering"). This file wires
 * together an already-fetched `Application[]` (one query, no per-application follow-up query)
 * with `deriveNextAction`/`compareByAttention`; it never calls Supabase itself.
 */
export interface ApplicationWithNextAction {
  application: Application;
  nextAction: NextAction;
}

/**
 * Reduces every *relevant* status-change event for the user (from
 * `listOwnRelevantStatusChangeEvents` — see that query's own doc comment for why it must NOT be
 * the capped "recent activity" query, and for exactly which two categories it already excludes
 * at the database layer) down to, per application, the single most recent one's `createdAt` —
 * exactly "when did this application's current status last *legitimately* change" (Phase 5C
 * hardening: the follow-up heuristic's anchor; see docs/IMPLEMENTATION_PLAN.md "Phase 5C
 * hardening — follow-up anchor / revert exclusion"). Assumes the input is already ordered
 * newest-first (as `listOwnRelevantStatusChangeEvents` returns it) and simply keeps the first
 * timestamp seen per `applicationId`.
 *
 * The two filters below are defensive, even though the query already applies them server-side —
 * matching this codebase's established double-filtering pattern (see `toRecentActivity`'s
 * identical posture): nothing here trusts the caller to have passed an already-correct list.
 * A reverted event, or the `SYSTEM`-sourced event that logs a revert, must never be able to
 * masquerade as a legitimate status update, no matter what the caller passes in. `USER`- and
 * `GMAIL_SYNC`-sourced events are both trusted equally once those two categories are excluded —
 * see next-action-rules.ts's `lastRelevantStatusActivityAt` doc comment for why.
 */
export function buildLastRelevantStatusActivityMap(
  relevantStatusChangeEvents: ApplicationEvent[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of relevantStatusChangeEvents) {
    if (event.eventType !== 'STATUS_CHANGE') continue;
    if (event.revertedAt) continue;
    if (event.source === 'SYSTEM') continue;
    if (!map.has(event.applicationId)) {
      map.set(event.applicationId, event.createdAt);
    }
  }
  return map;
}

export function attachNextActions(
  applications: Application[],
  relevantStatusChangeEvents: ApplicationEvent[],
  now: string,
): ApplicationWithNextAction[] {
  const lastRelevantStatusActivityByApplication = buildLastRelevantStatusActivityMap(
    relevantStatusChangeEvents,
  );
  return applications.map((application) => ({
    application,
    nextAction: deriveNextAction({
      status: application.status,
      unresolvedFields: application.unresolvedFields,
      appliedAt: application.appliedAt,
      lastRelevantStatusActivityAt:
        lastRelevantStatusActivityByApplication.get(application.id) ?? null,
      now,
    }),
  }));
}

export function sortApplicationsByAttention(
  items: ApplicationWithNextAction[],
): ApplicationWithNextAction[] {
  return [...items].sort((a, b) =>
    compareByAttention(
      {
        id: a.application.id,
        priority: a.nextAction.priority,
        appliedAt: a.application.appliedAt,
        updatedAt: a.application.updatedAt,
      },
      {
        id: b.application.id,
        priority: b.nextAction.priority,
        appliedAt: b.application.appliedAt,
        updatedAt: b.application.updatedAt,
      },
    ),
  );
}

/**
 * "Needs attention" is exactly priority URGENT, HIGH, or MEDIUM — defined in exactly one place
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2D") so the dashboard's count and its "Attention
 * needed" section membership never drift apart. Deliberately excludes LOW (CONSIDER_FOLLOW_UP,
 * COMPLETE_APPLICATION) and NONE: a Career OS follow-up recommendation gets its own separately-
 * labeled section rather than being counted as an urgent need (docs/IMPLEMENTATION_PLAN.md
 * "Phase 5C.2A" — conflating the two would misrepresent a suggestion as a requirement), and
 * COMPLETE_APPLICATION is "something you could start," not something pressing.
 */
export function needsAttention(item: ApplicationWithNextAction): boolean {
  return (
    item.nextAction.priority === 'URGENT' ||
    item.nextAction.priority === 'HIGH' ||
    item.nextAction.priority === 'MEDIUM'
  );
}

/** Logical pipeline stage groupings for the dashboard's stage/pipeline overview
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2E") — buckets the existing tracked statuses into a
 * handful of user-facing stages without inventing any new status value. */
export const DASHBOARD_STAGE_GROUPS = {
  PREPARING: ['SAVED', 'IN_PROGRESS'],
  APPLIED: ['APPLIED', 'APPLICATION_RECEIVED'],
  ACTIVE_PROCESS: ['ASSESSMENT', 'INTERVIEW', 'ACTION_REQUIRED'],
  OFFER: ['OFFER'],
  CLOSED: ['REJECTED', 'WITHDRAWN'],
} as const satisfies Record<string, readonly Application['status'][]>;

export type DashboardStageGroup = keyof typeof DASHBOARD_STAGE_GROUPS;

const STATUS_TO_STAGE_GROUP: Record<
  Application['status'],
  DashboardStageGroup | 'OTHER'
> = Object.fromEntries(
  Object.entries(DASHBOARD_STAGE_GROUPS).flatMap(([group, statuses]) =>
    statuses.map((status) => [status, group as DashboardStageGroup]),
  ),
) as Record<Application['status'], DashboardStageGroup | 'OTHER'>;

/** UNKNOWN is a reachable-but-unwritten status (see next-action-rules.ts) — it does not belong
 * to any of the five user-facing stages above, so it is counted separately rather than silently
 * dropped or forced into a bucket that would misrepresent it. */
export function stageGroupForStatus(
  status: Application['status'],
): DashboardStageGroup | 'OTHER' {
  return STATUS_TO_STAGE_GROUP[status] ?? 'OTHER';
}

export interface RecentActivityItem {
  event: ApplicationEvent;
  applicationId: string;
  company: string;
  title: string;
}

/**
 * Maps application_events rows to their application's company/title using an already-fetched
 * applications list (a plain in-memory lookup, never a join or a second query — see
 * listOwnRecentApplicationEvents's own doc comment for why). Silently drops an event whose
 * application is no longer in the caller's list (e.g. deleted) rather than showing a broken row.
 * Only STATUS_CHANGE events are surfaced — NOTE/MANUAL_EDIT/EMAIL_MATCHED entries exist in the
 * timeline for the application detail page's own use, but are not "activity" a dashboard-level
 * feed needs to narrate (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2F": "avoid showing noisy internal
 * events that do not matter to the user").
 */
export function toRecentActivity(
  events: ApplicationEvent[],
  applications: Application[],
): RecentActivityItem[] {
  const byId = new Map(applications.map((a) => [a.id, a]));
  const items: RecentActivityItem[] = [];
  for (const event of events) {
    if (event.eventType !== 'STATUS_CHANGE' || event.revertedAt) continue;
    const application = byId.get(event.applicationId);
    if (!application) continue;
    items.push({
      event,
      applicationId: application.id,
      company: application.company,
      title: application.title,
    });
  }
  return items;
}
