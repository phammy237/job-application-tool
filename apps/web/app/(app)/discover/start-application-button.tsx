'use client';

import type { ApplicationStatus } from '@career-os/shared';
import { Button, StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * D6's one handoff control, reused identically on the `/discover` job card and the
 * `/discover/[id]` detail page (docs/JOB_DISCOVERY.md "Handoff button" — never two different
 * implementations of the same tracked/untracked decision). Renders one of exactly two states:
 *
 * - Untracked (`trackedApplicationId` null): "Start application" — never "Apply automatically" /
 *   "Quick apply" / "Auto apply". Calls the one canonical handoff endpoint
 *   (`POST /api/discovery/[id]/start-application`) and navigates to the real
 *   `/applications/[id]` on success. Never both this and "View application" render at once.
 * - Tracked: the real, existing application status via the same `StatusBadge` every other
 *   application surface uses (never a second status taxonomy) plus "View application", linking
 *   straight to `/applications/[id]` — no network call needed, since the job is already tracked.
 *
 * Client-side pending-state disables the button to discourage a double-click, but that is a UX
 * nicety only — the real duplicate-prevention guarantee is the database-level partial unique
 * index the handoff RPC relies on (migration 0032), not this component.
 */
export function StartApplicationButton({
  jobCatalogId,
  trackedApplicationId,
  trackedApplicationStatus,
}: {
  jobCatalogId: string;
  trackedApplicationId: string | null;
  trackedApplicationStatus: ApplicationStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (trackedApplicationId) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={trackedApplicationStatus ?? 'UNKNOWN'} />
        <Link
          href={`/applications/${trackedApplicationId}`}
          className="text-primary text-sm hover:underline"
        >
          View application
        </Link>
      </div>
    );
  }

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/discovery/${jobCatalogId}/start-application`, {
          method: 'POST',
        });
        const body = (await response.json().catch(() => null)) as
          | { applicationId?: string; error?: string }
          | null;
        if (!response.ok || !body?.applicationId) {
          setError(body?.error ?? 'Could not start this application. Please try again.');
          return;
        }
        router.push(`/applications/${body.applicationId}`);
      } catch {
        setError('Could not start this application. Please check your connection and try again.');
      }
    });
  }

  return (
    <div>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={start}>
        {pending ? 'Starting application…' : 'Start application'}
      </Button>
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </div>
  );
}
