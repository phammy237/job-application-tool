'use client';

import { Button, Input, Label, Select } from '@career-os/ui';
import { useId, useState } from 'react';

/**
 * The shared add/remove/weight editor behind Role, Seniority, Work mode, and Employment type
 * preferences (D5B) — one small reusable component instead of four near-identical ones, built
 * entirely from `packages/ui`'s existing `Select`/`Input`/`Button` (no tag-input library).
 *
 * A value absent from `values` is UNKNOWN for the user (docs/JOB_DISCOVERY.md "Discovery Scoring
 * Profile") — genuinely different from a value present with weight 0, which is an explicit "rated
 * zero." Removing a row here therefore deletes the key entirely rather than setting it to 0, and
 * "Add a preference" only ever offers options not already present, so a value can't silently end
 * up rated `0` by accident.
 */
export function PreferenceWeightEditor({
  legend,
  helpText,
  allOptions,
  labels,
  values,
  onChange,
}: {
  legend: string;
  helpText?: string;
  allOptions: readonly string[];
  labels: Record<string, string>;
  values: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const groupId = useId();
  const ratedKeys = Object.keys(values);
  const availableOptions = allOptions.filter((option) => !(option in values));
  const [toAdd, setToAdd] = useState(availableOptions[0] ?? '');

  function updateWeight(key: string, weight: number) {
    onChange({ ...values, [key]: weight });
  }

  function remove(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  function add() {
    if (!toAdd) return;
    onChange({ ...values, [toAdd]: 5 });
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {helpText ? <p className="text-muted-foreground text-xs">{helpText}</p> : null}

      {ratedKeys.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing rated yet — treated as unknown.</p>
      ) : (
        <ul className="space-y-2">
          {ratedKeys.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span className="min-w-32 flex-1 text-sm">{labels[key] ?? key}</span>
              <Label htmlFor={`${groupId}-${key}`} className="sr-only">
                {labels[key] ?? key} weight (0-10)
              </Label>
              <Input
                id={`${groupId}-${key}`}
                type="number"
                min={0}
                max={10}
                step={1}
                value={values[key]}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  updateWeight(key, Number.isFinite(parsed) ? Math.min(10, Math.max(0, parsed)) : 0);
                }}
                className="w-20"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(key)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {availableOptions.length > 0 ? (
        <div className="flex items-end gap-2 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor={`${groupId}-add`}>Add a preference</Label>
            <Select
              id={`${groupId}-add`}
              value={toAdd}
              onChange={(e) => setToAdd(e.target.value)}
              className="w-56"
            >
              {availableOptions.map((option) => (
                <option key={option} value={option}>
                  {labels[option] ?? option}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            Add
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
