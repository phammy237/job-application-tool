import { formatNextAction, type NextActionType } from '@career-os/shared';
import { StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import type { ApplicationWithNextAction } from '../../../lib/dashboard';
import { PriorityBadge } from './priority-badge';

/**
 * Phase 5C.4 — where each next-action type's dedicated panel lives on the application detail
 * page, if it has one at all (matching the `id` attributes set in
 * `apps/web/app/(app)/applications/[id]/page.tsx`). A plain HTML fragment, not a query parameter:
 * the server there has already independently decided whether to render each panel before this
 * hash could ever matter, so it can only ever point at something that's actually on the page —
 * it can never bypass either AI-assistance route's own real eligibility check on click, and a
 * browser simply ignores a fragment that matches nothing. `REVIEW_UNRESOLVED_FIELDS` and
 * `COMPLETE_APPLICATION` have no dedicated section yet (the former's real review flow lives in
 * the extension popup, not this page) — deliberately left unmapped/deferred rather than pointing
 * at something that doesn't exist.
 */
export const ACTION_TYPE_TO_PANEL_ID: Partial<Record<NextActionType, string>> = {
  CONSIDER_FOLLOW_UP: 'follow-up-draft-panel',
  PREPARE_INTERVIEW: 'interview-prep-panel',
  MARK_APPLIED: 'mark-applied-panel',
};

/**
 * The compact row used by the "Attention needed," "Applications to finish," and "Follow-up
 * suggestions" sections (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2C") — company, role, status, the
 * primary next action, and why, without overloading the row with everything Career OS knows
 * about the application (that detail lives on the application detail page, one click away).
 */
export function ApplicationActionRow({ item }: { item: ApplicationWithNextAction }) {
  const { application, nextAction } = item;
  const { title, reason } = formatNextAction(nextAction);
  const panelId = ACTION_TYPE_TO_PANEL_ID[nextAction.type];
  const href = `/applications/${application.id}${panelId ? `#${panelId}` : ''}`;

  return (
    <li className="border-border flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Link href={href} className="hover:text-primary font-medium hover:underline">
          {application.company} — {application.title}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={application.status} />
          <PriorityBadge priority={nextAction.priority} />
        </div>
        <p className="text-muted-foreground text-sm">{reason}</p>
      </div>
      <div className="text-sm font-medium sm:whitespace-nowrap sm:text-right">
        {title}
      </div>
    </li>
  );
}
