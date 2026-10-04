'use client';

import { memo, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, Input } from '@career-os/ui';
import type { AskAnswer, AskClaim, AskSupport } from '@career-os/shared';
import { VerificationBadge } from '../_components/badges';
import { nodeHref, safeExternalUrl } from '../graph/node-links';
import { askMyEvidence } from './actions';
import { EXAMPLE_QUESTIONS, MAX_QUESTION_LENGTH, askQuestionSchema } from './ask-schema';

const SOURCE_LABEL: Record<string, string> = {
  GITHUB_REPO: 'GitHub repository',
  GITHUB_README: 'GitHub README',
  GITHUB_PR: 'GitHub pull request',
  GITHUB_COMMIT: 'GitHub commit',
  RESUME: 'Résumé',
  USER_NOTE: 'Your note',
  LINK: 'Link',
  DOCUMENT: 'Document',
  AWARD: 'Award',
  OTHER: 'Other',
};
const ENTITY_LABEL: Record<string, string> = {
  PROJECT: 'Project',
  EXPERIENCE: 'Experience',
  ACHIEVEMENT: 'Achievement',
  STORY: 'Story',
  SKILL: 'Skill',
};

interface HistoryItem {
  id: number;
  answer: AskAnswer;
}

function SupportBlock({ support }: { support: AskSupport }) {
  const href = nodeHref(support.entityType, support.entityId);
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          {ENTITY_LABEL[support.entityType] ?? support.entityType}
        </span>
        {href ? (
          <Link href={href} className="text-primary font-medium underline">
            {support.label}
          </Link>
        ) : (
          <span className="font-medium">{support.label}</span>
        )}
      </div>
      {support.evidence.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          No linked evidence items yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2 border-l-2 pl-3">
          {support.evidence.map((ev) => {
            const url = safeExternalUrl(ev.sourceUrl);
            return (
              <li key={ev.evidenceId} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{ev.title}</span>
                  <VerificationBadge state={ev.verificationState} />
                </div>
                <p className="text-muted-foreground text-xs">
                  Source: {SOURCE_LABEL[ev.sourceType] ?? ev.sourceType}
                  {url ? (
                    <>
                      {' · '}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        Open source
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </>
                  ) : (
                    ' · no link stored'
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function ClaimBlock({ claim, index }: { claim: AskClaim; index: number }) {
  return (
    <li className="space-y-2">
      <p className="text-sm font-medium">
        <span className="text-muted-foreground mr-1">{index + 1}.</span>
        {claim.text}
      </p>
      <ul className="space-y-2">
        {claim.support.map((s) => (
          <SupportBlock key={`${s.entityType}:${s.entityId}`} support={s} />
        ))}
      </ul>
    </li>
  );
}

// Memoized: typing a new question must not re-render every earlier answer in the history.
const AnswerCard = memo(function AnswerCard({
  item,
  heading,
}: {
  item: HistoryItem;
  heading: 'h2' | 'h3';
}) {
  const { answer } = item;
  const H = heading;
  const Sub = heading === 'h2' ? 'h3' : 'h4';
  return (
    <article
      className="bg-card space-y-4 rounded-lg border p-4"
      aria-label={`Answer to: ${answer.question}`}
    >
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-wide">You asked</p>
        <H className="break-words text-base font-semibold">{answer.question}</H>
      </div>
      <section aria-label="Answer">
        <Sub className="text-sm font-semibold">Answer</Sub>
        {answer.insufficientEvidence ? (
          <div
            role="status"
            className="mt-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
          >
            <p className="font-medium">Career OS has no evidence for this.</p>
            <p className="mt-1 whitespace-pre-line">{answer.answer}</p>
            <p className="mt-1">
              Add a{' '}
              <Link className="text-primary underline" href="/my/projects">
                project
              </Link>
              , a{' '}
              <Link className="text-primary underline" href="/my/stories">
                story
              </Link>{' '}
              or{' '}
              <Link className="text-primary underline" href="/my/github">
                GitHub evidence
              </Link>{' '}
              that covers it, then ask again.
            </p>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-line text-sm">{answer.answer}</p>
        )}
      </section>
      {answer.claims.length > 0 && (
        <section aria-label="Supporting claims, evidence and sources">
          <Sub className="text-sm font-semibold">
            Supporting claims → Evidence → Source
          </Sub>
          <ol className="mt-2 space-y-4">
            {answer.claims.map((c, i) => (
              <ClaimBlock key={`${i}-${c.text}`} claim={c} index={i} />
            ))}
          </ol>
        </section>
      )}
      {answer.notes.length > 0 && (
        <section aria-label="Notes">
          <Sub className="text-sm font-semibold">Notes</Sub>
          <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5 text-sm">
            {answer.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
});

export function AskView() {
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pending, startTransition] = useTransition();
  const counter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (text: string): void => {
    const parsed = askQuestionSchema.safeParse(text);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid question.');
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await askMyEvidence(parsed.data);
      if (result.ok) {
        counter.current += 1;
        setHistory((h) => [{ id: counter.current, answer: result.answer }, ...h]);
        setQuestion('');
      } else {
        setError(result.error);
      }
    });
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    submit(question);
  };

  const [latest, ...older] = history;

  return (
    <div className="space-y-6">
      <p className="bg-accent/40 rounded-md border p-3 text-sm">
        Answers come only from evidence you stored. Nothing is generated or guessed.
      </p>

      <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
        <div>
          <label htmlFor="ask-question" className="text-sm font-medium">
            Your question
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <Input
              ref={inputRef}
              id="ask-question"
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Where have I used Python?"
              aria-describedby={error ? 'ask-error' : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
            />
            <Button type="submit" disabled={pending} className="sm:w-28">
              {pending ? 'Searching…' : 'Ask'}
            </Button>
          </div>
          {error && (
            <p id="ask-error" role="alert" className="text-destructive mt-1 text-sm">
              {error}
            </p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Try one of these:</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setQuestion(q);
                    submit(q);
                  }}
                  className="hover:bg-accent focus-visible:ring-ring min-h-[36px] rounded-full border px-3 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="false" className="space-y-4">
        {pending && (
          <p role="status" className="text-muted-foreground text-sm">
            Searching your stored evidence…
          </p>
        )}
        {!latest && !pending && (
          <p className="text-muted-foreground text-sm">Your answers will appear here.</p>
        )}
        {latest && <AnswerCard key={latest.id} item={latest} heading="h2" />}
      </div>

      {older.length > 0 && (
        <section aria-label="Earlier answers" className="space-y-3">
          <h2 className="text-sm font-semibold">Earlier in this session</h2>
          {older.map((item) => (
            <details key={item.id} className="rounded-lg border">
              <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-sm font-medium">
                {item.answer.question}
              </summary>
              <div className="p-3">
                <AnswerCard item={item} heading="h3" />
              </div>
            </details>
          ))}
          <p className="text-muted-foreground text-xs">
            History is kept only in this browser tab and is not saved.
          </p>
        </section>
      )}
    </div>
  );
}
