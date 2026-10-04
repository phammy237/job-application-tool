'use client';

import { Button } from '@career-os/ui';

/** Small destructive form that asks for window.confirm before submitting a server action. */
export function ConfirmDeleteForm({
  action,
  fields,
  label,
  ariaLabel,
  message,
}: {
  action: (formData: FormData) => Promise<void> | Promise<never>;
  fields: Record<string, string>;
  label: string;
  ariaLabel?: string;
  message: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant="ghost" size="sm" className="min-h-10" aria-label={ariaLabel ?? label}>
        {label}
      </Button>
    </form>
  );
}
