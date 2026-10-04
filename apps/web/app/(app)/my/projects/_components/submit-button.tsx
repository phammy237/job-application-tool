'use client';

import { Button, type ButtonProps } from '@career-os/ui';
import { useFormStatus } from 'react-dom';

/** Submit button that disables itself and swaps its label while the parent <form> action runs. */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
