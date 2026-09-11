import { Badge, type BadgeProps } from '@career-os/ui';
import type { NextActionPriority } from '@career-os/shared';

/**
 * Reuses the existing generic `Badge` variants rather than adding a new priority-specific
 * component to `@career-os/ui` for one dashboard feature (docs/IMPLEMENTATION_PLAN.md
 * "Phase 5C.2B"). URGENT is the only variant that maps to `destructive` — everything else stays
 * visually calm, since only an explicit employer ask or a live offer decision is ever URGENT
 * (never a Career OS-generated follow-up suggestion).
 */
const PRIORITY_LABELS: Record<NextActionPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'None',
};

const PRIORITY_VARIANTS: Record<NextActionPriority, BadgeProps['variant']> = {
  URGENT: 'destructive',
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
  NONE: 'outline',
};

export function PriorityBadge({ priority }: { priority: NextActionPriority }) {
  return <Badge variant={PRIORITY_VARIANTS[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}
