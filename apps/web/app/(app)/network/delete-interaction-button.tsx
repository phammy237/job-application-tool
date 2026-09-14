'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteInteractionAction } from './actions';

export function DeleteInteractionButton({
  contactId,
  interactionId,
}: {
  contactId: string;
  interactionId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm('Delete this interaction? This cannot be undone.')) {
          startTransition(() => {
            void deleteInteractionAction(contactId, interactionId);
          });
        }
      }}
    >
      {pending ? 'Deleting…' : 'Delete'}
    </Button>
  );
}
