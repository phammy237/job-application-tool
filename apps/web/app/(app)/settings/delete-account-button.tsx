'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteAccount } from './actions';

export function DeleteAccountButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      disabled={pending}
      onClick={() => {
        const confirmed = window.confirm(
          'Delete your Career OS account? This permanently removes your profile, résumés, ' +
            'applications, and every other record. This cannot be undone.',
        );
        if (confirmed) {
          startTransition(() => {
            void deleteAccount();
          });
        }
      }}
    >
      {pending ? 'Deleting…' : 'Delete my account'}
    </Button>
  );
}
