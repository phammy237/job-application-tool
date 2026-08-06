'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteApplication } from './actions';

export function DeleteApplicationButton({
  id,
  company,
}: {
  id: string;
  company: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Delete the ${company} application? This cannot be undone.`)) {
          startTransition(() => {
            void deleteApplication(id);
          });
        }
      }}
    >
      {pending ? 'Deleting…' : 'Delete application'}
    </Button>
  );
}
