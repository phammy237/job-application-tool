'use client';

import { Button } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { createMasterResumeVersionFromProfile } from './actions';

/** Phase C — "Create structured master resume" (no MASTER/no structured version exists yet) or
 * "Create new master version from profile" (one already exists) — same action either way, see
 * that function's own doc comment. Never mutates an existing version. */
export function CreateMasterVersionButton({ hasStructuredVersion }: { hasStructuredVersion: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={hasStructuredVersion ? 'outline' : 'default'}
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await createMasterResumeVersionFromProfile();
          if (result.status === 'error') {
            window.alert(result.message);
            return;
          }
          router.refresh();
        });
      }}
    >
      {pending
        ? 'Creating…'
        : hasStructuredVersion
          ? 'Create new master version from profile'
          : 'Create structured master resume'}
    </Button>
  );
}
