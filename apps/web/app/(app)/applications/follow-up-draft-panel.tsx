'use client';

import { Button, Input, Textarea } from '@career-os/ui';
import { useCallback, useState } from 'react';
import type { FollowUpDraftResult } from '@career-os/shared';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; draft: FollowUpDraftResult }
  | { status: 'action_not_current' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

const USED_CONTEXT_LABEL: Record<string, string> = {
  APPLICATION_STATUS: 'application status',
  APPLICATION_DATE: 'application date',
  FOLLOW_UP_TIMING: 'follow-up timing',
  JOB_SNAPSHOT: 'the job posting',
  CONFIRMED_EMPLOYER_EMAIL: 'a confirmed email from the company',
  CANDIDATE_NAME: 'your name',
};

/**
 * Phase 5C.3A/5C.3F — explicit, user-triggered follow-up drafting. No fetch of any kind happens on
 * mount or render; the only network call this component ever makes is the one POST triggered by
 * clicking "Draft follow-up" (or "Regenerate"), matching this repo's established
 * RequirementAnalysisPanel pattern for user-triggered AI (apps/web/app/(app)/applications/
 * requirement-analysis-panel.tsx). Never sends anything — no Gmail integration, no "send" action
 * exists here at all; the draft is copy/editable text only.
 */
export function FollowUpDraftPanel({ applicationId }: { applicationId: string }) {
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [editedBody, setEditedBody] = useState('');
  const [editedSubject, setEditedSubject] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setGeneration({ status: 'generating' });
    setCopied(false);
    try {
      const response = await fetch(`/api/applications/${applicationId}/follow-up-draft`, {
        method: 'POST',
      });
      const body = (await response.json()) as {
        status?: string;
        draft?: FollowUpDraftResult;
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
      if (!response.ok || body.status === 'validation_failed' || !body.draft) {
        setGeneration({
          status: 'error',
          message: body.error ?? 'Drafting failed. Try again.',
        });
        return;
      }

      setEditedBody(body.draft.body);
      setEditedSubject(body.draft.subject ?? '');
      setGeneration({ status: 'ready', draft: body.draft });
    } catch {
      setGeneration({ status: 'error', message: 'Drafting failed. Try again.' });
    }
  }, [applicationId]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedBody);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser — no draft content is lost either way,
      // the text is still visible and selectable in the textarea.
    }
  }, [editedBody]);

  const isGenerating = generation.status === 'generating';
  const isReady = generation.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Follow-up draft</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={isGenerating}
          onClick={() => void generate()}
        >
          {isGenerating ? 'Drafting…' : isReady ? 'Regenerate' : 'Draft follow-up'}
        </Button>
      </div>

      {generation.status === 'action_not_current' ? (
        <p className="text-muted-foreground text-sm">
          This application&apos;s status changed — a follow-up draft is no longer
          suggested here. Refresh the page to see its current next action.
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
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            AI-generated draft — review and edit before using it. Based on:{' '}
            {generation.draft.usedContext
              .map((tag) => USED_CONTEXT_LABEL[tag] ?? tag)
              .join(', ')}
            . Career OS never sends this for you.
          </p>
          {editedSubject || generation.draft.subject !== null ? (
            <Input
              aria-label="Subject"
              value={editedSubject}
              onChange={(event) => setEditedSubject(event.target.value)}
              placeholder="Subject"
            />
          ) : null}
          <Textarea
            aria-label="Follow-up message"
            value={editedBody}
            onChange={(event) => setEditedBody(event.target.value)}
            rows={8}
          />
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
