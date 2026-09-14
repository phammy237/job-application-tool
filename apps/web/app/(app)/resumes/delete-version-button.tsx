'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { deleteResumeVersion } from './actions';

export function DeleteVersionButton({
  resumeId,
  versionId,
  label,
}: {
  resumeId: string;
  versionId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
        startTransition(async () => {
          const result = await deleteResumeVersion(resumeId, versionId);
          if (result.status === 'error') {
            window.alert(result.message);
          }
        });
      }}
    >
      {pending ? 'Deleting…' : 'Delete'}
    </Button>
  );
}
