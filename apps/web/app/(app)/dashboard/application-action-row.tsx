import { formatNextAction } from '@career-os/shared';
import { StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import type { ApplicationWithNextAction } from '../../../lib/dashboard';
import { PriorityBadge } from './priority-badge';

/**
 * The compact row used by both the "Attention needed" and "Follow-up suggestions" sections
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2C") — company, role, status, the primary next action,
 * and why, without overloading the row with everything Career OS knows about the application
 * (that detail lives on the application detail page, one click away).
 */
export function ApplicationActionRow({ item }: { item: ApplicationWithNextAction }) {
  const { application, nextAction } = item;
  const { title, reason } = formatNextAction(nextAction);

  return (
    <li className="border-border flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Link
          href={`/applications/${application.id}`}
          className="hover:text-primary font-medium hover:underline"
        >
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
