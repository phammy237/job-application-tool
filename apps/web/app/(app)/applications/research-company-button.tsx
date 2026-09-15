'use client';

import { Button } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type State = { kind: 'idle' } | { kind: 'error'; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  research_provider_unavailable:
    'Company research isn’t configured yet in this environment.',
  no_useful_sources: 'No useful public sources were found for this company.',
  insufficient_source_evidence:
    'Sources were found, but none had usable content to research from.',
  stale_application_context:
    'This application changed while research was running — try again.',
};

/**
 * "Research company" / "Refresh research" (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §46) — the
 * ONLY way research ever runs; no automatic call anywhere. Mirrors `CreateTailoredResumeButton`'s
 * shape: one POST, then `router.refresh()` so the server-rendered section above picks up the new
 * snapshot — never a client-side snapshot fetch of its own.
 */
export function ResearchCompanyButton({
  applicationId,
  label,
}: {
  applicationId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ kind: 'idle' });

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setState({ kind: 'idle' });
          startTransition(async () => {
            try {
              const response = await fetch(
                `/api/applications/${applicationId}/company-research`,
                {
                  method: 'POST',
                },
              );
              const body = (await response.json()) as { status?: string; error?: string };

              if (response.status === 429) {
                setState({
                  kind: 'error',
                  message: 'You’ve reached your AI request limit for this period.',
                });
                return;
              }
              if (body.status && body.status !== 'ok') {
                setState({
                  kind: 'error',
                  message:
                    ERROR_MESSAGES[body.status] ??
                    body.error ??
                    'Research failed. Try again.',
                });
                return;
              }
              if (!response.ok) {
                setState({
                  kind: 'error',
                  message: body.error ?? 'Research failed. Try again.',
                });
                return;
              }

              router.refresh();
            } catch {
              setState({ kind: 'error', message: 'Research failed. Try again.' });
            }
          });
        }}
      >
        {pending ? 'Researching…' : label}
      </Button>
      {state.kind === 'error' ? (
        <p className="text-destructive text-xs">{state.message}</p>
      ) : null}
    </div>
  );
}
