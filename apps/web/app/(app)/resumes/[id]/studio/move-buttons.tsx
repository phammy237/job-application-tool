'use client';

import { Button } from '@career-os/ui';

/** Explicit move-up/move-down/remove controls — no drag-and-drop (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7C" §22: "Do not overbuild drag-and-drop if simple move-up/move-down controls are
 * safer. Accessibility matters."). Plain buttons are keyboard- and screen-reader-operable by
 * default; a drag handle would need a parallel keyboard path to match that. */
export function MoveButtons({
  onMoveUp,
  onMoveDown,
  onRemove,
  itemLabel,
}: {
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  itemLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Move ${itemLabel} up`}
        onClick={onMoveUp}
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Move ${itemLabel} down`}
        onClick={onMoveDown}
      >
        ↓
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Remove ${itemLabel}`}
        onClick={onRemove}
      >
        ✕
      </Button>
    </div>
  );
}
