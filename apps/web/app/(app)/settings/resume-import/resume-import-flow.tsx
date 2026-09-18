'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { analyzeResume } from '../../../../lib/resume-import/analyze-client';
import { buildExtractionState } from '../../../../lib/resume-import/build-extraction-state';
import { buildReviewedResumeImportPayload } from '../../../../lib/resume-import/build-reviewed-payload';
import { ReviewScreen } from '../../../../lib/resume-import/review-screen';
import type { CurrentProfile, ExtractionState } from '../../../../lib/resume-import/types';
import type { ConfirmImportResult } from '../../../api/profile/resume-import/confirm/route';
import { ResumeUploadOrPaste } from '../../../../lib/resume-import/resume-upload-or-paste';

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'analyze_error'; message: string }
  | { kind: 'reviewing'; extraction: ExtractionState }
  | { kind: 'confirming'; extraction: ExtractionState }
  | { kind: 'confirm_error'; extraction: ExtractionState; message: string }
  | { kind: 'done'; result: ConfirmImportResult };

export function ResumeImportFlow({ currentProfile }: { currentProfile: CurrentProfile | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function handleAnalyze(input: { kind: 'file'; file: File } | { kind: 'text'; text: string }) {
    setStage({ kind: 'analyzing' });
    const outcome = await analyzeResume(input);
    if (!outcome.ok) {
      setStage({ kind: 'analyze_error', message: outcome.error });
      return;
    }
    setStage({ kind: 'reviewing', extraction: buildExtractionState(outcome.result, currentProfile) });
  }

  async function handleConfirm(extraction: ExtractionState) {
    setStage({ kind: 'confirming', extraction });
    const payload = buildReviewedResumeImportPayload(extraction);

    try {
      const res = await fetch('/api/profile/resume-import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as ConfirmImportResult | { error: unknown } | null;
      if (!res.ok || !body || 'error' in body) {
        setStage({
          kind: 'confirm_error',
          extraction,
          message: 'Could not save your approved items — please try again.',
        });
        return;
      }
      setStage({ kind: 'done', result: body });
      router.refresh();
    } catch {
      setStage({
        kind: 'confirm_error',
        extraction,
        message: 'Could not save your approved items — please try again.',
      });
    }
  }

  if (stage.kind === 'idle' || stage.kind === 'analyzing' || stage.kind === 'analyze_error') {
    return (
      <ResumeUploadOrPaste
        analyzing={stage.kind === 'analyzing'}
        errorMessage={stage.kind === 'analyze_error' ? stage.message : null}
        onAnalyze={handleAnalyze}
      />
    );
  }

  if (stage.kind === 'done') {
    return (
      <div className="border-border space-y-2 rounded-lg border p-6 text-sm">
        <p className="font-medium">Import complete.</p>
        <ul className="text-muted-foreground list-inside list-disc">
          <li>
            {stage.result.experiencesCreated} experience item(s) added
            {stage.result.experiencesSkippedAsDuplicate > 0
              ? ` (${stage.result.experiencesSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.educationCreated} education item(s) added
            {stage.result.educationSkippedAsDuplicate > 0
              ? ` (${stage.result.educationSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.projectsCreated} project(s) added
            {stage.result.projectsSkippedAsDuplicate > 0
              ? ` (${stage.result.projectsSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.skillsCreated} skill(s) added
            {stage.result.skillsSkippedAsDuplicate > 0
              ? ` (${stage.result.skillsSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
        </ul>
        <a href="/profile" className="text-primary text-sm underline underline-offset-2">
          Go to your Candidate Profile
        </a>
      </div>
    );
  }

  // reviewing / confirming / confirm_error
  const extraction = stage.extraction;
  const pending = stage.kind === 'confirming';

  return (
    <ReviewScreen
      extraction={extraction}
      pending={pending}
      errorMessage={stage.kind === 'confirm_error' ? stage.message : null}
      confirmLabel="Confirm import"
      pendingLabel="Saving…"
      onChange={(next) => setStage({ kind: 'reviewing', extraction: next })}
      onConfirm={() => void handleConfirm(extraction)}
      onCancel={() => setStage({ kind: 'idle' })}
    />
  );
}
