'use client';

import { Input, Label } from '@career-os/ui';
import { useId, type ReactNode } from 'react';

/**
 * One row of the "What matters to you" criteria list (D5B). `weight === 0` *is* "disabled" in
 * the D4 data model — there is no separate boolean, so the checkbox is just a convenience view
 * over that same number (docs/JOB_DISCOVERY.md "Match-score math": "0 disables a criterion —
 * excluded entirely from scoring and coverage, not scored as zero-fit"). Deliberately does NOT
 * render anything about "Unknown" here — that's a per-job, /discover-time fact this settings page
 * never has data for; the shared explanation of "disabled vs Unknown" lives once, in the section
 * intro above this list, not repeated per row.
 */
export function CriterionRow({
  label,
  description,
  weight,
  onChange,
  extra,
}: {
  label: string;
  description: string;
  weight: number;
  onChange: (weight: number) => void;
  extra?: ReactNode;
}) {
  const id = useId();
  const enabled = weight > 0;

  return (
    <div className="border-border flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? Math.max(weight, 5) : 0)}
            className="border-input h-4 w-4 rounded"
          />
          <Label htmlFor={`${id}-enabled`} className="font-medium">
            {label}
          </Label>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        {extra}
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <Label htmlFor={`${id}-weight`} className="text-muted-foreground text-xs">
          {enabled ? 'Weight (0-10)' : 'Disabled'}
        </Label>
        <Input
          id={`${id}-weight`}
          type="number"
          min={0}
          max={10}
          step={1}
          value={weight}
          aria-label={`${label} weight, 0 to 10`}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(parsed) ? Math.min(10, Math.max(0, parsed)) : 0);
          }}
          className="w-20"
        />
      </div>
    </div>
  );
}
