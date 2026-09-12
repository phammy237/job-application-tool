'use client';

import { Badge, Button } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { InterviewPrepResult } from '@career-os/shared';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; prep: InterviewPrepResult }
  | { status: 'action_not_current' }
  | { status: 'insufficient_context' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Phase 5C.3B/5C.3G — explicit, user-triggered interview preparation. Same no-fetch-on-mount
 * posture as FollowUpDraftPanel — the only network call is the one POST triggered by clicking
 * "Generate interview prep" (or "Regenerate"). Ephemeral: a page refresh loses the result, since
 * this pipeline persists nothing (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3E") — acceptable per that
 * decision, and it also means there is never a "stale persisted result" to distinguish from a
 * fresh one in this UI.
 */
export function InterviewPrepPanel({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });

  const generate = useCallback(async () => {
    setGeneration({ status: 'generating' });
    try {
      const response = await fetch(`/api/applications/${applicationId}/interview-prep`, {
        method: 'POST',
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
  }, [applicationId]);

  const isGenerating = generation.status === 'generating';
  const isReady = generation.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">
          Interview preparation
        </h2>
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
      </div>

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
      {generation.status === 'error' ? (
        <p className="text-destructive text-sm">{generation.message}</p>
      ) : null}

      {isReady ? <PrepSections prep={generation.prep} /> : null}
    </section>
  );
}

function PrepSections({ prep }: { prep: InterviewPrepResult }) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        {prep.provenanceSummary} AI-generated — a starting point, not a prediction of
        actual interview questions.
      </p>

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

function PrepGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}
