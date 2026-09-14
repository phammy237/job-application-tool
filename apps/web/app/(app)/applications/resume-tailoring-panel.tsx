'use client';

import type { ResumeTailoringProposal } from '@career-os/shared';
import { Button } from '@career-os/ui';
import { useCallback, useState } from 'react';
import { ResumeTailoringReviewSession } from './resume-tailoring-review-session';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; proposal: ResumeTailoringProposal }
  | { status: 'no_working_resume' }
  | { status: 'unsupported_resume_format' }
  | { status: 'missing_job_snapshot' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Phase 7E generates the proposal (docs/IMPLEMENTATION_PLAN.md "Phase 7E") — an explicit,
 * user-triggered, read-only call. Phase 7F takes over from there: reviewing, editing, and
 * optionally saving that proposal (`ResumeTailoringReviewSession`) is a separate, deterministic,
 * zero-AI-call layer (§16/§42/§61). Same no-fetch-on-mount posture as InterviewPrepPanel/
 * FollowUpDraftPanel: the only network call this top-level component makes on its own is the one
 * POST triggered by clicking "Tailor resume for this job" (or "Regenerate") — the review session
 * below makes its own single POST only when the user explicitly clicks Save.
 */
export function ResumeTailoringPanel({ applicationId }: { applicationId: string }) {
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });

  const generate = useCallback(async () => {
    if (
      generation.status === 'ready' &&
      !window.confirm(
        'Generating a new proposal discards your current, unsaved review. Continue?',
      )
    ) {
      return;
    }

    setGeneration({ status: 'generating' });
    try {
      const response = await fetch(
        `/api/applications/${applicationId}/resume-tailoring`,
        {
          method: 'POST',
        },
      );
      const body = (await response.json()) as {
        status?: string;
        proposal?: ResumeTailoringProposal;
        error?: string;
      };

      if (response.status === 429) {
        setGeneration({ status: 'rate_limited' });
        return;
      }
      if (body.status === 'no_working_resume') {
        setGeneration({ status: 'no_working_resume' });
        return;
      }
      if (body.status === 'unsupported_resume_format') {
        setGeneration({ status: 'unsupported_resume_format' });
        return;
      }
      if (body.status === 'missing_job_snapshot') {
        setGeneration({ status: 'missing_job_snapshot' });
        return;
      }
      if (!response.ok || body.status === 'validation_failed' || !body.proposal) {
        setGeneration({
          status: 'error',
          message: body.error ?? 'Tailoring failed. Try again.',
        });
        return;
      }

      setGeneration({ status: 'ready', proposal: body.proposal });
    } catch {
      setGeneration({ status: 'error', message: 'Tailoring failed. Try again.' });
    }
  }, [applicationId, generation.status]);

  const isGenerating = generation.status === 'generating';
  const isReady = generation.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">AI résumé tailoring</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={isGenerating}
          aria-busy={isGenerating}
          onClick={() => void generate()}
        >
          {isGenerating
            ? 'Tailoring…'
            : isReady
              ? 'Regenerate'
              : 'Tailor resume for this job'}
        </Button>
      </div>

      {generation.status === 'no_working_resume' ? (
        <p className="text-muted-foreground text-sm">
          Select a working résumé above before tailoring it for this job.
        </p>
      ) : null}
      {generation.status === 'unsupported_resume_format' ? (
        <p className="text-muted-foreground text-sm">
          The selected working résumé doesn&apos;t have structured content yet. Open it in
          the Resume Studio and save a version there first.
        </p>
      ) : null}
      {generation.status === 'missing_job_snapshot' ? (
        <p className="text-muted-foreground text-sm">
          There&apos;s no saved job posting for this application, so Career OS has nothing
          role-specific to tailor toward yet.
        </p>
      ) : null}
      {generation.status === 'rate_limited' ? (
        <p className="text-muted-foreground text-sm">
          You&apos;ve reached your AI request limit for this period.
        </p>
      ) : null}
      {generation.status === 'error' ? (
        <p className="text-destructive text-sm">{generation.message}</p>
      ) : null}

      {isReady ? (
        <ResumeTailoringReviewSession
          applicationId={applicationId}
          proposal={generation.proposal}
        />
      ) : null}
    </section>
  );
}
