'use client';

import { useTransition } from 'react';
import { revertEvent } from './actions';

export function RevertEventButton({
  applicationId,
  eventId,
}: {
  applicationId: string;
  eventId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => void revertEvent(applicationId, eventId))}
      className="text-primary text-xs font-medium hover:underline disabled:opacity-50"
    >
      {pending ? 'Undoing…' : 'Undo'}
    </button>
  );
}
