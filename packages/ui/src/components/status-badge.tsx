import { cn } from '../lib/cn';

/**
 * Matches docs/PRODUCT_SPEC.md §7's status list and the `status-*` tokens in
 * tailwind-preset.ts. Kept as a lookup table (not a switch) so adding a status is a one-line
 * change here plus one CSS variable in apps/web/app/globals.css.
 */
const STATUS_LABELS: Record<string, string> = {
  SAVED: 'Saved',
  IN_PROGRESS: 'In progress',
  APPLIED: 'Applied',
  APPLICATION_RECEIVED: 'Received',
  ASSESSMENT: 'Assessment',
  INTERVIEW: 'Interview',
  ACTION_REQUIRED: 'Action required',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Unknown',
};

const STATUS_COLOR_CLASSES: Record<string, string> = {
  SAVED: 'bg-status-saved/15 text-status-saved',
  IN_PROGRESS: 'bg-status-progress/15 text-status-progress',
  APPLIED: 'bg-status-applied/15 text-status-applied',
  APPLICATION_RECEIVED: 'bg-status-received/15 text-status-received',
  ASSESSMENT: 'bg-status-assessment/15 text-status-assessment',
  INTERVIEW: 'bg-status-interview/15 text-status-interview',
  ACTION_REQUIRED: 'bg-status-action/15 text-status-action',
  OFFER: 'bg-status-offer/15 text-status-offer',
  REJECTED: 'bg-status-rejected/15 text-status-rejected',
  WITHDRAWN: 'bg-status-withdrawn/15 text-status-withdrawn',
  UNKNOWN: 'bg-status-unknown/15 text-status-unknown',
};

export interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_COLOR_CLASSES[status] ?? STATUS_COLOR_CLASSES.UNKNOWN,
        className,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
