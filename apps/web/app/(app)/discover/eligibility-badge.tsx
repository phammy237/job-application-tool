import { Badge, type BadgeProps } from '@career-os/ui';
import type { EligibilityStatus } from '@career-os/shared';

/**
 * Reuses the generic `Badge` variants, same posture as `dashboard/priority-badge.tsx` — no new
 * component added to `@career-os/ui` for one feature. Deliberately NOT a red/green pass-fail
 * scheme: CONFLICT is the only variant that reads as an alert (`destructive`, since a real
 * conflict between the posting and the user's profile deserves visibility — docs/JOB_DISCOVERY.md
 * "Eligibility UI" — "conflicts made highly visible"); ELIGIBLE and UNKNOWN both stay visually
 * calm (`secondary`/`outline`) since "ELIGIBLE" is not a promise of an offer and "UNKNOWN" is not
 * a failure, just missing information. The text label is always present alongside the color, so
 * this is never a color-only signal.
 */
const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  ELIGIBLE: 'No conflicts found',
  UNKNOWN: 'Eligibility unknown',
  CONFLICT: 'Possible conflict',
};

const ELIGIBILITY_VARIANTS: Record<EligibilityStatus, BadgeProps['variant']> = {
  ELIGIBLE: 'secondary',
  UNKNOWN: 'outline',
  CONFLICT: 'destructive',
};

export function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  return <Badge variant={ELIGIBILITY_VARIANTS[status]}>{ELIGIBILITY_LABELS[status]}</Badge>;
}
