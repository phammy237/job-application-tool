'use client';

import type { ResumeTailoringProposal, ResumeTailoringResearchMode } from '@career-os/shared';
import { Button } from '@career-os/ui';
import Link from 'next/link';
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
  | { status: 'research_snapshot_not_found' }
  | { status: 'stale_company_research' }
  | { status: 'error'; message: string };

export interface LatestCompanyResearchSummary {
  id: string;
  researchedAt: string;
}

/**
 * Phase 7E generates the proposal (docs/IMPLEMENTATION_PLAN.md "Phase 7E") — an explicit,
 * user-triggered, read-only call. Phase 7F takes over from there: reviewing, editing, and
 * optionally saving that proposal (`ResumeTailoringReviewSession`) is a separate, deterministic,
 * zero-AI-call layer (§16/§42/§61). Same no-fetch-on-mount posture as InterviewPrepPanel/
 * FollowUpDraftPanel: the only network call this top-level component makes on its own is the one
 * POST triggered by clicking "Tailor resume for this job" (or "Regenerate") — the review session
 * below makes its own single POST only when the user explicitly clicks Save.
 *
 * Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §35/§36/§37) — when `latestCompanyResearch` is
 * given (a snapshot exists for this application), a mode selector lets the user choose whether to
 * fold it into this generation. Company research is NEVER mandatory just because a snapshot
 * exists: with no snapshot, the button behaves exactly as it always has, and even with one, the
 * user can still choose "Tailor using job posting only" with zero friction.
 */
export function ResumeTailoringPanel({
  applicationId,
  latestCompanyResearch,
}: {
  applicationId: string;
  latestCompanyResearch: LatestCompanyResearchSummary | null;
}) {
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [researchMode, setResearchMode] = useState<ResumeTailoringResearchMode>(
    latestCompanyResearch ? 'JOB_PLUS_COMPANY_RESEARCH' : 'JOB_ONLY',
  );

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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            researchMode,
            ...(researchMode === 'JOB_PLUS_COMPANY_RESEARCH' && latestCompanyResearch
              ? { companyResearchSnapshotId: latestCompanyResearch.id }
              : {}),
          }),
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
      if (body.status === 'research_snapshot_not_found') {
        setGeneration({ status: 'research_snapshot_not_found' });
        return;
      }
      if (body.status === 'stale_company_research') {
        setGeneration({ status: 'stale_company_research' });
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
  }, [applicationId, generation.status, researchMode, latestCompanyResearch]);

  const isGenerating = generation.status === 'generating';
  const isReady = generation.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">AI résumé tailoring</h2>
      </div>

      {latestCompanyResearch ? (
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`research-mode-${applicationId}`}
              checked={researchMode === 'JOB_PLUS_COMPANY_RESEARCH'}
              onChange={() => setResearchMode('JOB_PLUS_COMPANY_RESEARCH')}
            />
            Use latest research — {formatDate(latestCompanyResearch.researchedAt)}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`research-mode-${applicationId}`}
              checked={researchMode === 'JOB_ONLY'}
              onChange={() => setResearchMode('JOB_ONLY')}
            />
            Tailor using job posting only
          </label>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Tailor using job posting only —{' '}
          <Link
            href={`/applications/${applicationId}/company-research`}
            className="text-primary hover:underline"
          >
            Research company first
          </Link>{' '}
          to also weigh current company priorities.
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={isGenerating}
        aria-busy={isGenerating}
        onClick={() => void generate()}
      >
        {isGenerating ? 'Tailoring…' : isReady ? 'Regenerate' : 'Tailor resume for this job'}
      </Button>

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
      {generation.status === 'research_snapshot_not_found' ? (
        <p className="text-destructive text-sm">
          That company research snapshot is no longer available. Refresh the page and try
          again.
        </p>
      ) : null}
      {generation.status === 'stale_company_research' ? (
        <p className="text-destructive text-sm">
          The company research on file no longer matches this application&apos;s current
          company or job posting.{' '}
          <Link
            href={`/applications/${applicationId}/company-research`}
            className="text-primary hover:underline"
          >
            Research company again
          </Link>
          , or tailor using the job posting only.
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
