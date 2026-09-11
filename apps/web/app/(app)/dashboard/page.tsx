import { listOwnApplications, listOwnRecentApplicationEvents } from '@career-os/database';
import { Card, CardContent, CardHeader, CardTitle, StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import {
  attachNextActions,
  DASHBOARD_STAGE_GROUPS,
  needsAttention,
  sortApplicationsByAttention,
  stageGroupForStatus,
  toRecentActivity,
  type DashboardStageGroup,
} from '../../../lib/dashboard';
import { createClient } from '../../../lib/supabase/server';
import { ApplicationActionRow } from './application-action-row';

/** How many of the user's most recent application_events to pull for the activity feed — one
 * bounded query, not one per application (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2H"). Some may
 * be filtered out by toRecentActivity (reverted, or not a STATUS_CHANGE), so this is a fetch
 * cap, not a guaranteed display count. */
const RECENT_ACTIVITY_FETCH_LIMIT = 15;

const STAGE_GROUP_LABELS: Record<DashboardStageGroup, string> = {
  PREPARING: 'Preparing',
  APPLIED: 'Applied',
  ACTIVE_PROCESS: 'Active process',
  OFFER: 'Offer',
  CLOSED: 'Closed',
};

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [applications, recentEvents] = await Promise.all([
    listOwnApplications(supabase, user.id),
    listOwnRecentApplicationEvents(supabase, user.id, RECENT_ACTIVITY_FETCH_LIMIT),
  ]);

  const now = new Date().toISOString();
  const withNextActions = sortApplicationsByAttention(
    attachNextActions(applications, now),
  );
  const attentionItems = withNextActions.filter(needsAttention);
  const followUpItems = withNextActions.filter(
    (item) => item.nextAction.type === 'CONSIDER_FOLLOW_UP',
  );
  const recentActivity = toRecentActivity(recentEvents, applications);

  const stageCounts: Record<DashboardStageGroup | 'OTHER', number> = {
    PREPARING: 0,
    APPLIED: 0,
    ACTIVE_PROCESS: 0,
    OFFER: 0,
    CLOSED: 0,
    OTHER: 0,
  };
  for (const application of applications) {
    stageCounts[stageGroupForStatus(application.status)] += 1;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {applications.length === 0
            ? `Welcome back, ${user.email}.`
            : attentionItems.length > 0
              ? `${attentionItems.length} application${attentionItems.length === 1 ? '' : 's'} need${attentionItems.length === 1 ? 's' : ''} attention.`
              : 'Nothing needs attention right now.'}
        </p>
      </div>

      {applications.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm">
            <p>
              Fill out your profile first, then add your first application to start
              tracking it.
            </p>
            <div className="flex gap-3">
              <Link
                href="/applications"
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
              >
                View applications
              </Link>
              <Link
                href="/profile"
                className="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-4 py-2 text-sm font-medium"
              >
                Edit profile
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">
              Attention needed
            </h2>
            {attentionItems.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                Nothing needs attention right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {attentionItems.map((item) => (
                  <ApplicationActionRow key={item.application.id} item={item} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">
              Follow-up suggestions
              <span className="ml-2 text-xs font-normal">
                (Career OS recommendations — not known employer deadlines)
              </span>
            </h2>
            {followUpItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No follow-up suggestions right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {followUpItems.map((item) => (
                  <ApplicationActionRow key={item.application.id} item={item} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">
              Pipeline overview
            </h2>
            <div className="grid gap-3 sm:grid-cols-5">
              {(Object.keys(DASHBOARD_STAGE_GROUPS) as DashboardStageGroup[]).map(
                (group) => (
                  <Card key={group}>
                    <CardContent className="pt-6">
                      <p className="text-2xl font-semibold tracking-tight">
                        {stageCounts[group]}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {STAGE_GROUP_LABELS[group]}
                      </p>
                    </CardContent>
                  </Card>
                ),
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">Recent activity</h2>
            {recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recent activity.</p>
            ) : (
              <ul className="space-y-2">
                {recentActivity.map((item) => (
                  <li
                    key={item.event.id}
                    className="border-border flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Link
                      href={`/applications/${item.applicationId}`}
                      className="hover:text-primary font-medium hover:underline"
                    >
                      {item.company} — {item.title}
                    </Link>
                    {item.event.fromStatus ? (
                      <StatusBadge status={item.event.fromStatus} />
                    ) : null}
                    {item.event.fromStatus ? (
                      <span className="text-muted-foreground">→</span>
                    ) : null}
                    {item.event.toStatus ? (
                      <StatusBadge status={item.event.toStatus} />
                    ) : null}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {new Date(item.event.createdAt).toLocaleString()}
                      {item.event.source === 'GMAIL_SYNC' ? ' · via Gmail' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex gap-3">
            <Link
              href="/applications"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
            >
              View applications
            </Link>
            <Link
              href="/profile"
              className="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-4 py-2 text-sm font-medium"
            >
              Edit profile
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
