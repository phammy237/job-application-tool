'use client';

import { useState } from 'react';
import { analyzeResume } from '../../../lib/resume-import/analyze-client';
import { buildExtractionState } from '../../../lib/resume-import/build-extraction-state';
import { buildReviewedResumeImportPayload, type ReviewedResumeImportPayload } from '../../../lib/resume-import/build-reviewed-payload';
import { ReviewScreen } from '../../../lib/resume-import/review-screen';
import { ResumeUploadOrPaste } from '../../../lib/resume-import/resume-upload-or-paste';
import type { CurrentProfile, ExtractionState } from '../../../lib/resume-import/types';

interface ExistingForDedupe {
  experience: { company: string; title: string; description: string | null }[];
  education: { school: string; degree: string | null; fieldOfStudy: string | null }[];
  projects: { name: string; description: string | null }[];
  skills: { name: string }[];
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'analyze_error'; message: string }
  | { kind: 'reviewing'; extraction: ExtractionState }
  | { kind: 'applying'; extraction: ExtractionState };

/**
 * The /profile page's inline "Have a resume already?" onboarding helper — the third Resume
 * Import surface, alongside /settings/resume-import, sharing the exact same analyze pipeline,
 * extraction-state builder, and review UI (apps/web/lib/resume-import/*). The one thing that
 * differs from /settings/resume-import: confirming review here NEVER calls the confirm API —
 * `onAutofill` hands the reviewed, already-deduped payload straight to the page's client state so
 * it can prefill the Profile form/sections in memory. Nothing is persisted until the user clicks
 * Save on the relevant section (see profile-page-client.tsx) — Candidate Profile stays the one
 * canonical source of truth, and this panel never writes to it directly.
 */
export function ResumeAutofillPanel({
  currentProfile,
  existing,
  onAutofill,
}: {
  currentProfile: CurrentProfile | null;
  existing: ExistingForDedupe;
  onAutofill: (payload: ReviewedResumeImportPayload) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function handleAnalyze(input: { kind: 'file'; file: File } | { kind: 'text'; text: string }) {
    setStage({ kind: 'analyzing' });
    const outcome = await analyzeResume(input);
    if (!outcome.ok) {
      setStage({ kind: 'analyze_error', message: outcome.error });
      return;
    }
    setStage({ kind: 'reviewing', extraction: buildExtractionState(outcome.result, currentProfile, existing) });
  }

  function handleConfirm(extraction: ExtractionState) {
    setStage({ kind: 'applying', extraction });
    onAutofill(buildReviewedResumeImportPayload(extraction));
    setStage({ kind: 'idle' });
  }

  if (stage.kind === 'reviewing' || stage.kind === 'applying') {
    return (
      <div className="border-border bg-card space-y-4 rounded-lg border p-4">
        <p className="font-medium">Review your résumé</p>
        <p className="text-muted-foreground text-sm">
          Choose what to include, edit anything that looks off, then autofill the form below.
        </p>
        <ReviewScreen
          extraction={stage.extraction}
          pending={stage.kind === 'applying'}
          errorMessage={null}
          confirmLabel="Autofill profile form"
          pendingLabel="Applying…"
          onChange={(next) => setStage({ kind: 'reviewing', extraction: next })}
          onConfirm={() => handleConfirm(stage.extraction)}
          onCancel={() => setStage({ kind: 'idle' })}
        />
      </div>
    );
  }

  return (
    <ResumeUploadOrPaste
      heading="Have a resume already?"
      description="Upload a resume or paste your resume text to autofill your profile below."
      analyzing={stage.kind === 'analyzing'}
      errorMessage={stage.kind === 'analyze_error' ? stage.message : null}
      onAnalyze={handleAnalyze}
    />
  );
}
