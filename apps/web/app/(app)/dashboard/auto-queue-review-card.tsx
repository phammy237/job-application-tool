'use client';

import type { Application, UserJobMatchScore } from '@career-os/shared';
import { Button } from '@career-os/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MatchCoverageEligibility } from '../discover/match-coverage-eligibility';

/**
 * One Auto Mode-queued application awaiting the user's Keep/Dismiss decision (migration 0047, D9
 * Phase A) — mirrors `EmailSignalConfirmationCard`'s fetch-the-route-then-`router.refresh()`
 * shape. Match/Coverage/Eligibility is this job's CURRENT score (the same live values `/discover`
 * shows), not a frozen snapshot — `matchScore` is undefined when the job was never scored or has
 * since been removed from scoring, in which case the badges are simply omitted rather than shown
 * as zero/unknown.
 */
export function AutoQueueReviewCard({
  application,
  matchScore,
}: {
  application: Application;
  matchScore?: UserJobMatchScore;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const resolve = (action: 'KEEP' | 'DISMISS') => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/applications/${application.id}/auto-queue-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(typeof body.error === 'string' ? body.error : 'Could not save your decision.');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="border-border bg-card space-y-2 rounded-lg border p-3">
      <Link href={`/applications/${application.id}`} className="hover:underline">
        <p className="text-sm font-medium">
          {application.company} — {application.title}
        </p>
      </Link>
      {matchScore ? (
        <MatchCoverageEligibility
          matchScore={matchScore.matchScore}
          coverage={matchScore.coverage}
          eligibilityStatus={matchScore.eligibilityStatus}
        />
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => resolve('KEEP')}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => resolve('DISMISS')}>
          Dismiss
        </Button>
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
