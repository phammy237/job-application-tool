'use client';

import type { ResumeDateRange } from '@career-os/shared';
import { Input, Label } from '@career-os/ui';

/** Free month/year fields, not a single free-text date string (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7C" §24) — a résumé date is display-safe presentation data ("May 2025"), not a precise
 * timestamp, but still structured enough to validate and reformat deterministically. */
export function DateRangeFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: ResumeDateRange;
  onChange: (next: ResumeDateRange) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-start-month`} className="text-xs">
          Start month
        </Label>
        <Input
          id={`${idPrefix}-start-month`}
          type="number"
          min={1}
          max={12}
          placeholder="MM"
          value={value.start?.month ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              start: {
                year: value.start?.year ?? new Date().getFullYear(),
                month: e.target.value ? Number(e.target.value) : null,
              },
            })
          }
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-start-year`} className="text-xs">
          Start year
        </Label>
        <Input
          id={`${idPrefix}-start-year`}
          type="number"
          placeholder="YYYY"
          value={value.start?.year ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              start: e.target.value
                ? { year: Number(e.target.value), month: value.start?.month ?? null }
                : null,
            })
          }
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-end-month`} className="text-xs">
          End month
        </Label>
        <Input
          id={`${idPrefix}-end-month`}
          type="number"
          min={1}
          max={12}
          placeholder="MM"
          disabled={value.isPresent}
          value={value.end?.month ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              end: {
                year: value.end?.year ?? new Date().getFullYear(),
                month: e.target.value ? Number(e.target.value) : null,
              },
            })
          }
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-end-year`} className="text-xs">
          End year
        </Label>
        <Input
          id={`${idPrefix}-end-year`}
          type="number"
          placeholder="YYYY"
          disabled={value.isPresent}
          value={value.end?.year ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              end: e.target.value
                ? { year: Number(e.target.value), month: value.end?.month ?? null }
                : null,
            })
          }
        />
      </div>
      <label className="col-span-2 flex items-center gap-1.5 text-xs sm:col-span-4">
        <input
          type="checkbox"
          checked={value.isPresent}
          onChange={(e) => onChange({ ...value, isPresent: e.target.checked, end: null })}
        />
        Present (still ongoing)
      </label>
    </div>
  );
}
