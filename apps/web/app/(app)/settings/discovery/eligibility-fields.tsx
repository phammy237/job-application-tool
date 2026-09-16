'use client';

import { Input, Label, Select } from '@career-os/ui';
import { useId } from 'react';

/**
 * Tri-state Yes/No/Unknown control for one boolean eligibility field. Deliberately a `<select>`
 * with an explicit "Unknown" option, not a checkbox (which can only be checked/unchecked, with no
 * clean third state) — every D4 eligibility field is nullable and `null` genuinely means "the
 * user hasn't told us" (docs/JOB_DISCOVERY.md "Eligibility profile"), never defaulted to No. There
 * is no required-field validation anywhere on this page: leaving every field at "Unknown" is a
 * fully valid, save-able state.
 */
export function EligibilityBooleanField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  const id = useId();
  const selectValue = value === null ? '' : value ? 'true' : 'false';

  return (
    <div className="space-y-1.5 py-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-muted-foreground text-xs">{description}</p>
      <Select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? null : raw === 'true');
        }}
        className="w-40"
      >
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    </div>
  );
}

export function GraduationYearField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const id = useId();

  return (
    <div className="space-y-1.5 py-2">
      <Label htmlFor={id}>Graduation year</Label>
      <p className="text-muted-foreground text-xs">
        Used to check postings that state a specific graduating-class requirement (e.g. new-grad
        programs). Leave blank if unknown.
      </p>
      <Input
        id={id}
        type="number"
        min={2000}
        max={2100}
        step={1}
        value={value ?? ''}
        placeholder="Unknown"
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === '') {
            onChange(null);
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
        className="w-28"
      />
    </div>
  );
}
