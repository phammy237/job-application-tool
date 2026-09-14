'use client';

import { Button } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { createTailoredResumeForApplication } from './actions';

/** docs/IMPLEMENTATION_PLAN.md "Phase 7A" §21 — creates a new TAILORED resume named per this
 * application's company/role and immediately selects its first version as this application's
 * working résumé. */
export function CreateTailoredResumeButton({
  applicationId,
  company,
  title,
}: {
  applicationId: string;
  company: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await createTailoredResumeForApplication(applicationId);
          if (result.status === 'error') {
            window.alert(result.message);
            return;
          }
          router.refresh();
        });
      }}
    >
      {pending ? 'Creating…' : `Create resume for ${company} — ${title}`}
    </Button>
  );
}
