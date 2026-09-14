'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteResume } from './actions';

export function DeleteResumeButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
        startTransition(async () => {
          const result = await deleteResume(id);
          if (result.status === 'error') {
            window.alert(result.message);
          }
        });
      }}
    >
      {pending ? 'Deleting…' : 'Delete resume'}
    </Button>
  );
}
