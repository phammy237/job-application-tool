'use client';

import { Button } from '@career-os/ui';
import { useTransition } from 'react';
import { unlinkContactFromApplicationAction } from './actions';

/** Shared "unlink" affordance for both the application People section and the contact detail
 * page's linked-applications list — the same underlying link row, viewed from either side. */
export function UnlinkButton({
  applicationId,
  contactId,
  role,
}: {
  applicationId: string;
  contactId: string;
  role: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          void unlinkContactFromApplicationAction(applicationId, contactId, role);
        });
      }}
    >
      {pending ? 'Unlinking…' : 'Unlink'}
    </Button>
  );
}
