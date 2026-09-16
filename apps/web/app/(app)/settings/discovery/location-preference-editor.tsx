'use client';

import type { LocationPreferenceCategory } from '@career-os/shared';
import { Button, Label, Select } from '@career-os/ui';
import { useId, useState } from 'react';
import {
  LOCATION_PREFERENCE_CATEGORY_LABELS,
  formatLocationTokenLabel,
} from '../../discover/discovery-display-labels';

const CATEGORIES: LocationPreferenceCategory[] = ['PREFERRED', 'ACCEPTABLE', 'AVOID', 'EXCLUDE'];

/**
 * Location preferences are category-based (`PREFERRED`/`ACCEPTABLE`/`AVOID`/`EXCLUDE`), not a
 * 0-10 weight, so this is its own small editor rather than a `PreferenceWeightEditor` variant —
 * `EXCLUDE` is a hard personal filter (removes a matching job from consideration entirely, never
 * merely scored low — docs/JOB_DISCOVERY.md "Discovery Scoring Profile"), which the copy below
 * calls out explicitly since it behaves differently from the other three. Options come from the
 * real, already-observed catalog (`list_discovery_location_tokens`, the same source `/discover`'s
 * own location filter uses) — never a free-text field, so a token can never fail to normalize.
 */
export function LocationPreferenceEditor({
  locationTokens,
  values,
  onChange,
}: {
  locationTokens: string[];
  values: Record<string, LocationPreferenceCategory>;
  onChange: (next: Record<string, LocationPreferenceCategory>) => void;
}) {
  const groupId = useId();
  const ratedTokens = Object.keys(values);
  const availableTokens = locationTokens.filter((token) => !(token in values));
  const [toAdd, setToAdd] = useState(availableTokens[0] ?? '');

  function updateCategory(token: string, category: LocationPreferenceCategory) {
    onChange({ ...values, [token]: category });
  }

  function remove(token: string) {
    const next = { ...values };
    delete next[token];
    onChange(next);
  }

  function add() {
    if (!toAdd) return;
    onChange({ ...values, [toAdd]: 'PREFERRED' });
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Locations you prefer</legend>
      <p className="text-muted-foreground text-xs">
        &ldquo;Exclude entirely&rdquo; removes a matching job from your results completely — it
        is a personal filter, not part of your Match score.
      </p>

      {ratedTokens.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No locations rated yet — treated as unknown.
        </p>
      ) : (
        <ul className="space-y-2">
          {ratedTokens.map((token) => (
            <li key={token} className="flex items-center gap-2">
              <span className="min-w-32 flex-1 text-sm">{formatLocationTokenLabel(token)}</span>
              <Label htmlFor={`${groupId}-${token}`} className="sr-only">
                {formatLocationTokenLabel(token)} preference
              </Label>
              <Select
                id={`${groupId}-${token}`}
                value={values[token]}
                onChange={(e) => updateCategory(token, e.target.value as LocationPreferenceCategory)}
                className="w-40"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {LOCATION_PREFERENCE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(token)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {availableTokens.length > 0 ? (
        <div className="flex items-end gap-2 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor={`${groupId}-add`}>Add a location</Label>
            <Select
              id={`${groupId}-add`}
              value={toAdd}
              onChange={(e) => setToAdd(e.target.value)}
              className="w-56"
            >
              {availableTokens.map((token) => (
                <option key={token} value={token}>
                  {formatLocationTokenLabel(token)}
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
