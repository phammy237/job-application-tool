'use client';

import { useTransition } from 'react';
import { clearWorkingResumeVersion } from './actions';

export function ClearWorkingResumeButton({ applicationId }: { applicationId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="text-muted-foreground text-xs hover:underline disabled:opacity-50"
      onClick={() => startTransition(() => void clearWorkingResumeVersion(applicationId))}
    >
      {pending ? 'Clearing…' : 'Clear'}
    </button>
  );
}
