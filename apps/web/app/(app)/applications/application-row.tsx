'use client';

import type { Application, NextAction } from '@career-os/shared';
import { formatNextAction } from '@career-os/shared';
import { StatusBadge } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatFriendlyDate } from '../../../lib/format-friendly-date';
import { ACTION_TYPE_TO_PANEL_ID } from '../dashboard/application-action-row';
import { PriorityBadge } from '../dashboard/priority-badge';

/**
 * A mouse convenience layered on top of, never a replacement for, the real links inside —
 * clicking anywhere in the row navigates to the application, but Company/Next-action stay real
 * `<Link>`s so keyboard, right-click-to-open-in-new-tab, and screen-reader users are unaffected.
 * `stopPropagation` on the inner links prevents a double-navigation when a link itself is
 * clicked directly.
 */
export function ApplicationRow({
  application,
  nextAction,
}: {
  application: Application;
  nextAction: NextAction;
}) {
  const router = useRouter();
  const href = `/applications/${application.id}`;

  return (
    <tr
      onClick={() => router.push(href)}
      className="border-border hover:bg-accent/40 border-b last:border-0 cursor-pointer"
    >
      <td className="px-4 py-3">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-primary font-medium hover:underline"
        >
          {application.company}
        </Link>
      </td>
      <td className="px-4 py-3">{application.title}</td>
      <td className="px-4 py-3">
        <StatusBadge status={application.status} />
      </td>
      <td className="border-primary/30 border-l px-4 py-3">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={nextAction.priority} />
          {ACTION_TYPE_TO_PANEL_ID[nextAction.type] ? (
            <Link
              href={`${href}#${ACTION_TYPE_TO_PANEL_ID[nextAction.type]}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-primary hover:underline"
            >
              {formatNextAction(nextAction).title}
            </Link>
          ) : (
            <span>{formatNextAction(nextAction).title}</span>
          )}
        </div>
      </td>
      <td className="text-muted-foreground px-4 py-3">
        {formatFriendlyDate(application.updatedAt)}
      </td>
    </tr>
  );
}
