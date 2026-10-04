'use client';

import { Select } from '@career-os/ui';
import { useState } from 'react';

/** Visibility select that warns when PUBLIC is chosen (public also needs approval + portfolio). */
export function VisibilitySelect({
  defaultValue,
  options,
}: {
  defaultValue: string;
  options: readonly (readonly [string, string])[];
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <Select
        id="visibility"
        name="visibility"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby="vis-help vis-public-warning"
        className="max-w-xs"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <p
        id="vis-public-warning"
        role="status"
        className="text-xs text-amber-900 dark:text-amber-200"
      >
        {value === 'PUBLIC'
          ? 'Not exported until the project is approved and the portfolio is enabled'
          : ''}
      </p>
    </>
  );
}
