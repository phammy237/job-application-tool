'use client';

import { Badge, Button } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import type {
  CompanyResearchMode,
  CompanyResearchRelevanceItem,
  InterviewPrepResult,
} from '@career-os/shared';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; prep: InterviewPrepResult }
  | { status: 'action_not_current' }
  | { status: 'insufficient_context' }
  | { status: 'rate_limited' }
  | { status: 'research_snapshot_not_found' }
  | { status: 'stale_company_research' }
  | { status: 'error'; message: string };

export interface LatestCompanyResearchSummary {
  id: string;
  researchedAt: string;
}

/**
 * Phase 5C.3B/5C.3G — explicit, user-triggered interview preparation. Same no-fetch-on-mount
 * posture as FollowUpDraftPanel — the only network call is the one POST triggered by clicking
 * "Generate interview prep" (or "Regenerate"). Ephemeral: a page refresh loses the result, since
 * this pipeline persists nothing (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3E") — acceptable per that
 * decision, and it also means there is never a "stale persisted result" to distinguish from a
 * fresh one in this UI.
 *
 * Phase 7I (docs/IMPLEMENTATION_PLAN.md "Phase 7I") — when `latestCompanyResearch` is given (a
 * snapshot exists for this application), a mode selector analogous to résumé tailoring's own lets
 * the user choose whether to fold it into this generation. Company research is NEVER mandatory
 * just because a snapshot exists: with no snapshot, this panel behaves exactly as it always has.
 */
export function InterviewPrepPanel({
  applicationId,
  latestCompanyResearch,
}: {
  applicationId: string;
  latestCompanyResearch: LatestCompanyResearchSummary | null;
}) {
  const router = useRouter();
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [researchMode, setResearchMode] = useState<CompanyResearchMode>('JOB_ONLY');

  const generate = useCallback(async () => {
    setGeneration({ status: 'generating' });
    try {
      const response = await fetch(`/api/applications/${applicationId}/interview-prep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          researchMode,
          ...(researchMode === 'JOB_PLUS_COMPANY_RESEARCH' && latestCompanyResearch
            ? { companyResearchSnapshotId: latestCompanyResearch.id }
            : {}),
        }),
      });
      const body = (await response.json()) as {
        status?: string;
        prep?: InterviewPrepResult;
        error?: string;
      };

      if (response.status === 429) {
        setGeneration({ status: 'rate_limited' });
        return;
      }
      if (body.status === 'action_not_current') {
        setGeneration({ status: 'action_not_current' });
        return;
      }
      if (body.status === 'insufficient_context') {
        setGeneration({ status: 'insufficient_context' });
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
      if (!response.ok || body.status === 'validation_failed' || !body.prep) {
        setGeneration({
          status: 'error',
          message: body.error ?? 'Prep generation failed. Try again.',
        });
        return;
      }

      setGeneration({ status: 'ready', prep: body.prep });
    } catch {
      setGeneration({ status: 'error', message: 'Prep generation failed. Try again.' });
    }
  }, [applicationId, researchMode, latestCompanyResearch]);

  const isGenerating = generation.status === 'generating';
  const isReady = generation.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">
          Interview preparation
        </h2>
      </div>

      {latestCompanyResearch ? (
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`interview-research-mode-${applicationId}`}
              checked={researchMode === 'JOB_ONLY'}
              onChange={() => setResearchMode('JOB_ONLY')}
            />
            Job only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`interview-research-mode-${applicationId}`}
              checked={researchMode === 'JOB_PLUS_COMPANY_RESEARCH'}
              onChange={() => setResearchMode('JOB_PLUS_COMPANY_RESEARCH')}
            />
            Job + company research ({formatDate(latestCompanyResearch.researchedAt)})
          </label>
        </div>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        disabled={isGenerating}
        aria-busy={isGenerating}
        onClick={() => void generate()}
      >
        {isGenerating
          ? 'Generating…'
          : isReady
            ? 'Regenerate'
            : 'Generate interview prep'}
      </Button>

      {generation.status === 'action_not_current' ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            This application&apos;s tracked status changed since this page loaded —
            interview prep is no longer suggested here. Reload to see its current next
            action.
          </p>
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            Reload this page
          </Button>
        </div>
      ) : null}
      {generation.status === 'insufficient_context' ? (
        <p className="text-muted-foreground text-sm">
          There&apos;s no saved job posting for this application, so Career OS has nothing
          role-specific to prepare from yet.
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
          , or prepare using the job posting only.
        </p>
      ) : null}
      {generation.status === 'error' ? (
        <p className="text-destructive text-sm">{generation.message}</p>
      ) : null}

      {isReady ? <PrepSections applicationId={applicationId} prep={generation.prep} /> : null}
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

function PrepSections({
  applicationId,
  prep,
}: {
  applicationId: string;
  prep: InterviewPrepResult;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        {prep.provenanceSummary} AI-generated — a starting point, not a prediction of
        actual interview questions.
      </p>

      {/* Phase 7I §"Prompt design"/"Output metadata" — always reflects the ACTUAL mode used,
          never what was requested; never implies research is mandatory. */}
      {prep.researchMode === 'JOB_PLUS_COMPANY_RESEARCH' && prep.companyResearchResearchedAt ? (
        <p className="text-muted-foreground text-xs">
          Based on this job + company research from {formatDate(prep.companyResearchResearchedAt)}{' '}
          ({prep.selectedResearchFindingCount} finding
          {prep.selectedResearchFindingCount === 1 ? '' : 's'} considered) ·{' '}
          <Link
            href={`/applications/${applicationId}/company-research`}
            className="text-primary hover:underline"
          >
            View company research
          </Link>
        </p>
      ) : null}

      {prep.rolePriorities.length > 0 ? (
        <PrepGroup title="Role priorities">
          <ul className="space-y-1.5">
            {prep.rolePriorities.map((item, index) => (
              <li key={index} className="text-sm">
                <Badge
                  variant={item.importance === 'REQUIRED' ? 'secondary' : 'outline'}
                  className="mr-2"
                >
                  {item.importance}
                </Badge>
                {item.requirement}
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.evidenceToEmphasize.length > 0 ? (
        <PrepGroup title="What to emphasize">
          <ul className="space-y-1.5">
            {prep.evidenceToEmphasize.map((item, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{item.theme}:</span> {item.summary}
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.starStoryPrompts.length > 0 ? (
        <PrepGroup title="STAR stories to prepare">
          <ul className="space-y-1.5">
            {prep.starStoryPrompts.map((item, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{item.competency}:</span> {item.prompt}
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.possibleQuestions.length > 0 ? (
        <PrepGroup title="Potential questions to prepare for">
          <ul className="space-y-1.5">
            {prep.possibleQuestions.map((item, index) => (
              <li key={index} className="text-sm">
                {item.question}
                <p className="text-muted-foreground text-xs">{item.rationale}</p>
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.questionsToAsk.length > 0 ? (
        <PrepGroup title="Questions to ask">
          <ul className="space-y-1.5">
            {prep.questionsToAsk.map((item, index) => (
              <li key={index} className="text-sm">
                {item.question}
                <p className="text-muted-foreground text-xs">{item.rationale}</p>
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.gapsToPrepare.length > 0 ? (
        <PrepGroup title="Gaps to prepare">
          <ul className="space-y-1.5">
            {prep.gapsToPrepare.map((item, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{item.requirement}:</span> {item.note}
                <CompanyRelevanceNote applicationId={applicationId} companyRelevance={item.companyRelevance} />
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}

      {prep.submittedAnswersToReview.length > 0 ? (
        <PrepGroup title="Answers you already submitted">
          <ul className="space-y-1.5">
            {prep.submittedAnswersToReview.map((item, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{item.fieldLabel}:</span> {item.answerText}
              </li>
            ))}
          </ul>
        </PrepGroup>
      ) : null}
    </div>
  );
}

/**
 * Phase 7I §32/§33/§67 (résumé-tailoring precedent) — resolves `companyRelevance` (already
 * server-resolved from the exact snapshot used, never a client-supplied claim) into a small,
 * human-readable note. Never a raw uuid; never worded as something the candidate did — always
 * about why the company makes this worth preparing for.
 */
function CompanyRelevanceNote({
  applicationId,
  companyRelevance,
}: {
  applicationId: string;
  companyRelevance: CompanyResearchRelevanceItem[];
}) {
  if (companyRelevance.length === 0) return null;
  return (
    <div className="border-border/60 mt-1 space-y-1 border-l-2 pl-2 text-xs">
      <p className="text-muted-foreground font-medium">Company relevance:</p>
      {companyRelevance.map((item) => (
        <p key={item.id} className="text-muted-foreground">
          • {item.roleRelevance ?? item.claim}
        </p>
      ))}
      <Link
        href={`/applications/${applicationId}/company-research`}
        className="text-primary hover:underline"
      >
        View research
      </Link>
    </div>
  );
}

function PrepGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}
