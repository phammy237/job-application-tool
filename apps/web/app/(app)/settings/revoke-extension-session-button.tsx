'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { revokeExtensionSession } from './actions';

export function RevokeExtensionSessionButton({
  id,
  deviceLabel,
}: {
  id: string;
  deviceLabel: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        const label = deviceLabel ?? 'this device';
        if (window.confirm(`Disconnect the extension on ${label}?`)) {
          startTransition(() => {
            void revokeExtensionSession(id);
          });
        }
      }}
    >
      {pending ? 'Revoking…' : 'Revoke'}
    </Button>
  );
}
