'use client';

import { buildResumeFileName, type ResumeTailoringProposal } from '@career-os/shared';
import { Badge, Button } from '@career-os/ui';
import { useCallback, useState } from 'react';

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
 * Phase 7E — explicit, user-triggered grounded résumé tailoring. Same no-fetch-on-mount posture
 * as InterviewPrepPanel/FollowUpDraftPanel: the only network call this component ever makes is
 * the one POST triggered by clicking "Tailor resume for this job" (or "Regenerate").
 *
 * The result is a read-only PROPOSAL, never a save (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §21/
 * §37/§45) — nothing here creates a résumé version, changes the working résumé selection, or
 * touches the base résumé in any way. A page refresh loses the proposal, same as every other
 * ephemeral AI-assistance panel in this codebase; if the user wants to keep a change, they make it
 * themselves in the Resume Studio, which is the one real save path.
 */
export function ResumeTailoringPanel({ applicationId }: { applicationId: string }) {
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });

  const generate = useCallback(async () => {
    setGeneration({ status: 'generating' });
    try {
      const response = await fetch(`/api/applications/${applicationId}/resume-tailoring`, {
        method: 'POST',
      });
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
  }, [applicationId]);

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
          The selected working résumé doesn&apos;t have structured content yet. Open it in the
          Resume Studio and save a version there first.
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

      {isReady ? <ProposalView proposal={generation.proposal} /> : null}
    </section>
  );
}

function ProposalView({ proposal }: { proposal: ResumeTailoringProposal }) {
  const { summary, coverage } = proposal;

  function handleDownloadTex() {
    const filename = buildResumeFileName(`${proposal.baseResumeDisplayName}-tailored`, 'tex');
    const blob = new Blob([proposal.proposedResumeLatex], { type: 'text/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Based on {proposal.baseResumeDisplayName} (v{proposal.baseResumeVersionNumber}).{' '}
        <span className="font-medium">Nothing has been saved yet</span> — this is a preview only.
        To keep a change, make it yourself in the Resume Studio.
      </p>

      {proposal.customLatexOverridePresent ? (
        <p className="text-destructive text-sm">
          This résumé has a custom Advanced LaTeX override. This preview reflects only the
          structured-content changes below — it does not modify or include your override.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">{summary.rewrittenBullets} rewritten</Badge>
        <Badge variant="outline">{summary.addedBullets} added</Badge>
        <Badge variant="outline">{summary.omittedBullets} bullets omitted</Badge>
        <Badge variant="outline">{summary.omittedEntries} entries omitted</Badge>
        <Badge variant="outline">{summary.movedBullets} bullets moved</Badge>
        <Badge variant="outline">{summary.movedEntries} entries moved</Badge>
        {summary.skillsReordered ? <Badge variant="outline">Skills reordered</Badge> : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide">Requirement coverage</h3>
        <p className="text-muted-foreground text-sm">
          {coverage.coveredRequirementIds.length} of {coverage.totalRequirementCount} requirement
          {coverage.totalRequirementCount === 1 ? '' : 's'} addressed by this proposal.
        </p>
        {coverage.unsupportedRequirements.length > 0 ? (
          <ul className="space-y-1">
            {coverage.unsupportedRequirements.map((req) => (
              <li key={req.id} className="text-muted-foreground text-sm">
                No grounded evidence found for:{' '}
                <span className="text-foreground">{req.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {proposal.operations.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide">Proposed changes</h3>
          <ul className="space-y-2">
            {proposal.operations.map((op, index) => (
              <li key={index} className="border-border rounded-lg border p-3 text-sm">
                <OperationDescription op={op} />
                <p className="text-muted-foreground mt-1 text-xs">{op.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing needed to change for this role.
        </p>
      )}

      <Button variant="outline" size="sm" onClick={handleDownloadTex}>
        Download .tex preview
      </Button>
    </div>
  );
}

function OperationDescription({ op }: { op: ResumeTailoringProposal['operations'][number] }) {
  switch (op.type) {
    case 'REWRITE_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">{op.entryLabel}</p>
          <p className="text-muted-foreground line-through">{op.before}</p>
          <p>{op.after}</p>
        </div>
      );
    case 'ADD_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">Add to {op.entryLabel}</p>
          <p>{op.after}</p>
        </div>
      );
    case 'OMIT_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">Omit from {op.entryLabel}</p>
          <p className="text-muted-foreground line-through">{op.omittedText}</p>
        </div>
      );
    case 'OMIT_ENTRY':
      return <p>Omit entry: {op.entryLabel}</p>;
    case 'MOVE_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">
            Reorder within {op.entryLabel} (position {op.fromIndex + 1} → {op.toIndex + 1})
          </p>
          <p>{op.movedText}</p>
        </div>
      );
    case 'MOVE_ENTRY':
      return (
        <p>
          Reorder entry: {op.entryLabel} (position {op.fromIndex + 1} → {op.toIndex + 1})
        </p>
      );
    case 'REORDER_SKILLS':
      return (
        <p className="text-muted-foreground text-xs">
          Reorder skill groups: {op.after.join(', ')}
        </p>
      );
    default: {
      const exhaustiveCheck: never = op;
      return exhaustiveCheck;
    }
  }
}
