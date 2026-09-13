'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteContactAction } from './actions';

export function DeleteContactButton({ id, displayName }: { id: string; displayName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (
          window.confirm(
            `Delete ${displayName}? This removes their tags and any application links, but never touches the applications themselves. This cannot be undone.`,
          )
        ) {
          startTransition(() => {
            void deleteContactAction(id);
          });
        }
      }}
    >
      {pending ? 'Deleting…' : 'Delete contact'}
    </Button>
  );
}
