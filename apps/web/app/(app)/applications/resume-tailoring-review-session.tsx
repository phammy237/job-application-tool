'use client';

import {
  buildReviewedTailoredResume,
  buildResumeFileName,
  renderStructuredResumeToLatex,
  type ResumeTailoringOperationDecision,
  type ResumeTailoringOperationEdit,
  type ResumeTailoringOperationView,
  type ResumeTailoringOperationWithId,
  type ResumeTailoringProposal,
} from '@career-os/shared';
import { Badge, Button, Textarea } from '@career-os/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Decision = ResumeTailoringOperationDecision;
type Filter = 'ALL' | Decision;

interface SaveApiResult {
  status: string;
  applicationId?: string;
  resumeId?: string;
  resumeCreated?: boolean;
  versionId?: string;
  versionNumber?: number;
  displayName?: string;
  currentWorkingResumeVersionId?: string | null;
  currentJobSnapshotId?: string | null;
  reason?: string;
  error?: string;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; result: SaveApiResult }
  | { kind: 'stale_base_resume' }
  | { kind: 'stale_job_context' }
  | { kind: 'unresolved_operations' }
  | { kind: 'no_changes' }
  | { kind: 'no_working_resume' }
  | { kind: 'custom_latex_override_ack_required' }
  | { kind: 'validation_failed'; reason?: string }
  | { kind: 'error'; message: string };

/**
 * Phase 7H (§34) — a small, informational header stating exactly what this proposal was tailored
 * against: never implies research is mandatory, and always reflects the ACTUAL mode used
 * (`proposal.researchMode`), never what the user may have requested — e.g. a `JOB_PLUS_COMPANY_
 * RESEARCH` request silently degrades to `JOB_ONLY` server-side when no compatible snapshot
 * exists (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §4), and this header shows that outcome plainly.
 */
function TailoringContextHeader({
  applicationId,
  proposal,
}: {
  applicationId: string;
  proposal: ResumeTailoringProposal;
}) {
  return (
    <div className="border-border space-y-1 rounded-lg border p-3 text-xs">
      <p className="text-muted-foreground font-medium uppercase tracking-wide">
        Tailoring context
      </p>
      <p>Job posting: current snapshot</p>
      {proposal.researchMode === 'JOB_PLUS_COMPANY_RESEARCH' &&
      proposal.companyResearchResearchedAt ? (
        <p>
          Company research: {formatShortDate(proposal.companyResearchResearchedAt)} —{' '}
          {proposal.selectedResearchFindingCount} selected finding
          {proposal.selectedResearchFindingCount === 1 ? '' : 's'} ·{' '}
          <Link
            href={`/applications/${applicationId}/company-research`}
            className="text-primary hover:underline"
          >
            View company research
          </Link>
        </p>
      ) : (
        <p>
          Company research: Not used ·{' '}
          <Link
            href={`/applications/${applicationId}/company-research`}
            className="text-primary hover:underline"
          >
            Research company
          </Link>
        </p>
      )}
    </div>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function labelForDecision(decision: Decision): string {
  switch (decision) {
    case 'ACCEPTED':
      return 'Accepted';
    case 'REJECTED':
      return 'Rejected';
    case 'PENDING':
      return 'Pending review';
  }
}

function badgeVariantForDecision(
  decision: Decision,
): 'default' | 'outline' | 'secondary' {
  switch (decision) {
    case 'ACCEPTED':
      return 'default';
    case 'REJECTED':
      return 'secondary';
    case 'PENDING':
      return 'outline';
  }
}

/**
 * Phase 7F — the user-control layer over a Phase 7E proposal (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7F"). Review state (decisions/edits) lives entirely in this component's own React state
 * — never persisted anywhere until "Save Tailored Resume" succeeds (§3/§62). A page refresh loses
 * it, same as the ephemeral proposal itself; the `beforeunload` guard below only warns, it never
 * autosaves (§3: "Do not add autosave infrastructure casually").
 *
 * Every accept/reject/edit recomputes the reviewed résumé purely client-side via
 * `buildReviewedTailoredResume` (§46) — no network request per click, and the only network call
 * this whole component ever makes is the single explicit POST to .../resume-tailoring/save.
 */
export function ResumeTailoringReviewSession({
  applicationId,
  proposal,
}: {
  applicationId: string;
  proposal: ResumeTailoringProposal;
}) {
  const operations = useMemo<ResumeTailoringOperationWithId[]>(
    () =>
      proposal.operations.map((operation, index) => ({
        operationId: `op-${index}`,
        operation,
      })),
    [proposal],
  );

  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [edits, setEdits] = useState<Map<string, ResumeTailoringOperationEdit>>(
    new Map(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [acknowledgeOverrideReset, setAcknowledgeOverrideReset] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  // A freshly-generated proposal always starts every operation PENDING and clears any leftover
  // review state from a previous proposal (§5).
  useEffect(() => {
    setDecisions(new Map());
    setEdits(new Map());
    setEditingId(null);
    setAcknowledgeOverrideReset(false);
    setSaveState({ kind: 'idle' });
  }, [proposal]);

  const reviewed = useMemo(
    () =>
      buildReviewedTailoredResume({
        baseResume: proposal.baseResume,
        operations,
        decisions,
        edits,
        originalCoverage: proposal.coverage,
      }),
    [proposal, operations, decisions, edits],
  );

  const latex = useMemo(
    () => renderStructuredResumeToLatex(reviewed.resume),
    [reviewed.resume],
  );

  const hasUnsavedReview = decisions.size > 0 || edits.size > 0;
  useEffect(() => {
    if (!hasUnsavedReview || saveState.kind === 'ok') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedReview, saveState.kind]);

  function decisionFor(operationId: string): Decision {
    return decisions.get(operationId) ?? 'PENDING';
  }

  function setDecision(operationId: string, decision: Decision) {
    setDecisions((prev) => new Map(prev).set(operationId, decision));
    setSaveState({ kind: 'idle' });
    if (decision !== 'ACCEPTED' && editingId === operationId) setEditingId(null);
  }

  function saveEdit(operationId: string, edit: ResumeTailoringOperationEdit) {
    setEdits((prev) => new Map(prev).set(operationId, edit));
    setDecisions((prev) => new Map(prev).set(operationId, 'ACCEPTED'));
    setEditingId(null);
    setSaveState({ kind: 'idle' });
  }

  function clearEdit(operationId: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(operationId);
      return next;
    });
    setSaveState({ kind: 'idle' });
  }

  function acceptAllRemaining() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const { operationId } of operations) {
        if ((next.get(operationId) ?? 'PENDING') === 'PENDING')
          next.set(operationId, 'ACCEPTED');
      }
      return next;
    });
    setSaveState({ kind: 'idle' });
  }

  function rejectAllRemaining() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const { operationId } of operations) {
        if ((next.get(operationId) ?? 'PENDING') === 'PENDING')
          next.set(operationId, 'REJECTED');
      }
      return next;
    });
    setSaveState({ kind: 'idle' });
  }

  const needsOverrideAck =
    proposal.customLatexOverridePresent && !acknowledgeOverrideReset;
  const canSave =
    reviewed.counts.pending === 0 &&
    reviewed.groundingViolations.length === 0 &&
    reviewed.hasChangesFromBase &&
    !needsOverrideAck &&
    saveState.kind !== 'saving';

  async function handleSave() {
    setSaveState({ kind: 'saving' });
    try {
      const response = await fetch(
        `/api/applications/${applicationId}/resume-tailoring/save`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseResumeVersionId: proposal.baseResumeVersionId,
            jobSnapshotId: proposal.jobSnapshotId,
            acknowledgeCustomLatexOverrideReset: acknowledgeOverrideReset,
            // Phase 7H (§9/§41) — the exact snapshot this proposal was generated against, echoed
            // back verbatim so the saved version can carry immutable research provenance. Never
            // re-resolved to "whatever is latest now" — identity, not latestness (§9).
            companyResearchSnapshotId: proposal.companyResearchSnapshotId,
            operations: operations.map(({ operationId, operation }) => ({
              operationId,
              operation,
              decision: decisionFor(operationId),
              edit: edits.get(operationId) ?? null,
            })),
          }),
        },
      );
      const body = (await response.json()) as SaveApiResult;
      if (body.status === 'ok') {
        setSaveState({ kind: 'ok', result: body });
      } else if (
        body.status === 'stale_base_resume' ||
        body.status === 'stale_job_context' ||
        body.status === 'unresolved_operations' ||
        body.status === 'no_changes' ||
        body.status === 'no_working_resume' ||
        body.status === 'custom_latex_override_ack_required'
      ) {
        setSaveState({ kind: body.status });
      } else if (body.status === 'validation_failed') {
        setSaveState({ kind: 'validation_failed', reason: body.reason });
      } else {
        setSaveState({ kind: 'error', message: body.error ?? 'Save failed. Try again.' });
      }
    } catch {
      setSaveState({ kind: 'error', message: 'Save failed. Try again.' });
    }
  }

  if (saveState.kind === 'ok') {
    return <SaveSuccessView result={saveState.result} applicationId={applicationId} />;
  }

  const visibleOperations =
    filter === 'ALL'
      ? operations
      : operations.filter(({ operationId }) => decisionFor(operationId) === filter);

  return (
    <div className="space-y-4">
      <TailoringContextHeader applicationId={applicationId} proposal={proposal} />

      {proposal.customLatexOverridePresent ? (
        <div className="border-destructive/50 bg-destructive/5 space-y-2 rounded-lg border p-3">
          <p className="text-destructive text-sm">
            This résumé has a custom Advanced LaTeX override. Saving the tailored version
            will regenerate LaTeX from the structured content below and will not carry
            over the old override.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledgeOverrideReset}
              onChange={(e) => setAcknowledgeOverrideReset(e.target.checked)}
            />
            I understand the custom LaTeX override will be reset.
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{reviewed.counts.pending} pending</Badge>
          <Badge variant="outline">{reviewed.counts.accepted} accepted</Badge>
          <Badge variant="outline">{reviewed.counts.rejected} rejected</Badge>
          <Badge variant="outline">{reviewed.counts.edited} edited</Badge>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={acceptAllRemaining}>
            Accept all remaining
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={rejectAllRemaining}>
            Reject all remaining
          </Button>
        </div>
      </div>

      {operations.length > 1 ? (
        <div className="flex gap-1 text-xs">
          {(['ALL', 'PENDING', 'ACCEPTED', 'REJECTED'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-2.5 py-0.5 ${
                filter === f
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border'
              }`}
            >
              {f === 'ALL' ? 'All' : labelForDecision(f)}
            </button>
          ))}
        </div>
      ) : null}

      {operations.length > 0 ? (
        <ul className="space-y-2">
          {visibleOperations.map(({ operationId, operation }) => (
            <OperationCard
              key={operationId}
              applicationId={applicationId}
              operationId={operationId}
              operation={operation}
              decision={decisionFor(operationId)}
              edit={edits.get(operationId) ?? null}
              isEditing={editingId === operationId}
              violation={
                reviewed.groundingViolations.find((v) => v.operationId === operationId) ??
                null
              }
              onAccept={() => setDecision(operationId, 'ACCEPTED')}
              onReject={() => setDecision(operationId, 'REJECTED')}
              onStartEdit={() => setEditingId(operationId)}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(edit) => saveEdit(operationId, edit)}
              onClearEdit={() => clearEdit(operationId)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing needed to change for this role.
        </p>
      )}

      <FinalPreview
        reviewed={reviewed}
        latex={latex}
        totalOperations={operations.length}
      />

      <div className="space-y-2">
        {saveState.kind === 'stale_base_resume' ? (
          <p className="text-destructive text-sm">
            Your application&apos;s working résumé changed after this proposal was
            generated. Generate a new tailoring proposal from the current version.
          </p>
        ) : null}
        {saveState.kind === 'stale_job_context' ? (
          <p className="text-destructive text-sm">
            The job posting for this application changed after this proposal was
            generated. Generate a new tailoring proposal against the current job posting.
          </p>
        ) : null}
        {saveState.kind === 'unresolved_operations' ? (
          <p className="text-destructive text-sm">
            Every change must be accepted or rejected before saving.
          </p>
        ) : null}
        {saveState.kind === 'no_changes' ? (
          <p className="text-muted-foreground text-sm">No changes are selected.</p>
        ) : null}
        {saveState.kind === 'no_working_resume' ? (
          <p className="text-destructive text-sm">
            This application no longer has a working résumé selected. Select one and
            generate a new tailoring proposal.
          </p>
        ) : null}
        {saveState.kind === 'custom_latex_override_ack_required' ? (
          <p className="text-destructive text-sm">
            Acknowledge the custom LaTeX override reset above before saving.
          </p>
        ) : null}
        {saveState.kind === 'validation_failed' ? (
          <p className="text-destructive text-sm">
            This draft could not be saved as fact-grounded content
            {saveState.reason ? ` (${saveState.reason})` : ''}. Edit the change and either
            fix the wording or save it as manual content instead.
          </p>
        ) : null}
        {saveState.kind === 'error' ? (
          <p className="text-destructive text-sm">{saveState.message}</p>
        ) : null}
        {!reviewed.hasChangesFromBase &&
        reviewed.counts.pending === 0 &&
        reviewed.counts.total > 0 ? (
          <p className="text-muted-foreground text-sm">No changes are selected.</p>
        ) : null}
        {reviewed.counts.pending > 0 ? (
          <p className="text-muted-foreground text-sm">
            {reviewed.counts.pending} change{reviewed.counts.pending === 1 ? '' : 's'}{' '}
            still need review before you can save.
          </p>
        ) : null}

        <Button
          type="button"
          disabled={!canSave}
          aria-busy={saveState.kind === 'saving'}
          onClick={() => void handleSave()}
        >
          {saveState.kind === 'saving' ? 'Saving…' : 'Save Tailored Resume'}
        </Button>
      </div>
    </div>
  );
}

function OperationCard({
  applicationId,
  operationId,
  operation,
  decision,
  edit,
  isEditing,
  violation,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onClearEdit,
}: {
  applicationId: string;
  operationId: string;
  operation: ResumeTailoringOperationView;
  decision: Decision;
  edit: ResumeTailoringOperationEdit | null;
  isEditing: boolean;
  violation: { reason: string; detail: string } | null;
  onAccept: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (edit: ResumeTailoringOperationEdit) => void;
  onClearEdit: () => void;
}) {
  const editable = operation.type === 'REWRITE_BULLET' || operation.type === 'ADD_BULLET';
  const [draftText, setDraftText] = useState(
    edit?.text ?? (editable ? operation.after : ''),
  );
  const [draftProvenance, setDraftProvenance] = useState<'KEEP_GROUNDED' | 'MANUAL'>(
    edit?.provenanceChoice ?? 'MANUAL',
  );

  return (
    <li
      data-testid={`operation-${operationId}`}
      className="border-border space-y-2 rounded-lg border p-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badgeVariantForDecision(decision)}>
          {labelForDecision(decision)}
        </Badge>
        {edit ? (
          <Badge variant="outline">
            Edited — {edit.provenanceChoice === 'MANUAL' ? 'Manual' : 'Fact-grounded'}
          </Badge>
        ) : null}
      </div>

      <OperationDescription operation={operation} edit={edit} />

      {operation.type === 'REWRITE_BULLET' || operation.type === 'ADD_BULLET' ? (
        <div className="flex flex-wrap gap-1">
          {operation.groundedFacts.map((fact) => (
            <Badge key={fact.id} variant="outline">
              {fact.label}
            </Badge>
          ))}
        </div>
      ) : null}
      {operation.type === 'REWRITE_BULLET' || operation.type === 'ADD_BULLET' ? (
        <div className="flex flex-wrap gap-1">
          {operation.relevantRequirements.map((req) => (
            <Badge key={req.id} variant="secondary">
              {req.text}
            </Badge>
          ))}
        </div>
      ) : null}

      <CompanyRelevanceNote applicationId={applicationId} companyRelevance={operation.companyRelevance} />

      <p className="text-muted-foreground text-xs">{operation.reason}</p>

      {violation ? (
        <p className="text-destructive text-xs">
          This edit can&apos;t be saved as fact-grounded: {violation.detail}. Fix the
          wording, or switch to &quot;Save as manual content&quot; below.
        </p>
      ) : null}

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={3}
          />
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`provenance-${operationId}`}
                checked={draftProvenance === 'KEEP_GROUNDED'}
                onChange={() => setDraftProvenance('KEEP_GROUNDED')}
              />
              Keep as fact-grounded
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`provenance-${operationId}`}
                checked={draftProvenance === 'MANUAL'}
                onChange={() => setDraftProvenance('MANUAL')}
              />
              Save as manual content
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={draftText.trim().length === 0}
              onClick={() =>
                onSaveEdit({ text: draftText.trim(), provenanceChoice: draftProvenance })
              }
            >
              Use this text
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={decision === 'ACCEPTED' ? 'default' : 'outline'}
            onClick={onAccept}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant={decision === 'REJECTED' ? 'default' : 'outline'}
            onClick={onReject}
          >
            Reject
          </Button>
          {editable ? (
            <Button type="button" size="sm" variant="outline" onClick={onStartEdit}>
              Edit
            </Button>
          ) : null}
          {edit ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClearEdit}>
              Revert to AI proposal
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Phase 7H (§32/§33/§67) — resolves `researchFindingIds` into human-readable context. Never a raw
 * UUID, never a full source list (the research page is the canonical place for full citations —
 * this is just enough context to see WHY the operation is relevant, with a link out). Wording is
 * deliberately about the COMPANY, never the candidate (§67): "Company relevance: <claim>", never
 * "You worked on..." or "Your company work".
 */
function CompanyRelevanceNote({
  applicationId,
  companyRelevance,
}: {
  applicationId: string;
  companyRelevance: ResumeTailoringOperationView['companyRelevance'];
}) {
  if (companyRelevance.length === 0) return null;
  return (
    <div className="border-border/60 space-y-1 border-l-2 pl-2 text-xs">
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

function OperationDescription({
  operation,
  edit,
}: {
  operation: ResumeTailoringOperationView;
  edit: ResumeTailoringOperationEdit | null;
}) {
  switch (operation.type) {
    case 'REWRITE_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">{operation.entryLabel}</p>
          <p className="text-muted-foreground line-through">{operation.before}</p>
          <p>{edit?.text ?? operation.after}</p>
        </div>
      );
    case 'ADD_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">Add to {operation.entryLabel}</p>
          <p>{edit?.text ?? operation.after}</p>
        </div>
      );
    case 'OMIT_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">
            Omit from {operation.entryLabel}
          </p>
          <p className="text-muted-foreground line-through">{operation.omittedText}</p>
          <p className="text-xs">Existing content → will be omitted</p>
        </div>
      );
    case 'OMIT_ENTRY':
      return (
        <div>
          <p>Omit entry: {operation.entryLabel}</p>
          <p className="text-muted-foreground text-xs">
            Existing content → will be omitted
          </p>
        </div>
      );
    case 'MOVE_BULLET':
      return (
        <div>
          <p className="text-muted-foreground text-xs">
            Reorder within {operation.entryLabel} (position {operation.fromIndex + 1} →{' '}
            {operation.toIndex + 1})
          </p>
          <p>{operation.movedText}</p>
        </div>
      );
    case 'MOVE_ENTRY':
      return (
        <p>
          Reorder entry: {operation.entryLabel} (position {operation.fromIndex + 1} →{' '}
          {operation.toIndex + 1})
        </p>
      );
    case 'REORDER_SKILLS':
      return (
        <div>
          <p className="text-muted-foreground text-xs">
            Before: {operation.before.join(', ')}
          </p>
          <p className="text-xs">After: {operation.after.join(', ')}</p>
        </div>
      );
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function FinalPreview({
  reviewed,
  latex,
  totalOperations,
}: {
  reviewed: ReturnType<typeof buildReviewedTailoredResume>;
  latex: string;
  totalOperations: number;
}) {
  function handleDownloadTex() {
    const filename = buildResumeFileName('tailored-resume-preview', 'tex');
    const blob = new Blob([latex], { type: 'text/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide">
        Final tailored résumé
      </h3>
      <p className="text-muted-foreground text-sm">
        {reviewed.counts.accepted} of {totalOperations} change
        {totalOperations === 1 ? '' : 's'} accepted, {reviewed.counts.rejected} rejected,{' '}
        {reviewed.counts.edited} edited. Nothing is saved until you click Save Tailored
        Resume below.
      </p>
      <p className="text-muted-foreground text-sm">
        {reviewed.coverage.coveredRequirementIds.length} of{' '}
        {reviewed.coverage.totalRequirementCount} requirement
        {reviewed.coverage.totalRequirementCount === 1 ? '' : 's'} represented by accepted
        changes.
      </p>
      {reviewed.coverage.unsupportedRequirements.length > 0 ? (
        <ul className="space-y-1">
          {reviewed.coverage.unsupportedRequirements.map((req) => (
            <li key={req.id} className="text-muted-foreground text-sm">
              No accepted change addresses:{' '}
              <span className="text-foreground">{req.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={handleDownloadTex}>
        Download .tex preview
      </Button>
    </div>
  );
}

function SaveSuccessView({
  result,
  applicationId,
}: {
  result: SaveApiResult;
  applicationId: string;
}) {
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <p className="font-medium">Tailored résumé saved</p>
      <p className="text-muted-foreground text-sm">
        Created: {result.displayName} — Version {result.versionNumber}. Set as this
        application&apos;s working résumé.
      </p>
      <div className="flex gap-3">
        {result.resumeId ? (
          <Link
            href={`/resumes/${result.resumeId}/studio`}
            className="text-primary text-sm hover:underline"
          >
            Open in Resume Studio
          </Link>
        ) : null}
        <Link
          href={`/applications/${applicationId}`}
          className="text-primary text-sm hover:underline"
        >
          Back to Application
        </Link>
      </div>
    </div>
  );
}
