'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@career-os/ui';
import { markApplicationApplied } from './actions';

interface Finding {
  id: string;
  ruleId: string;
  severity: 'WARNING' | 'BLOCKING';
  fieldALabel: string;
  fieldAValue: string;
  fieldBLabel: string;
  fieldBValue: string;
  description: string;
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'review'; findings: Finding[]; acknowledged: Set<string> }
  | { kind: 'submitting'; findings: Finding[]; acknowledged: Set<string> }
  | { kind: 'error'; message: string };

/**
 * State for the separate, optional "Check for unsupported claims" AI-assisted affordance
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.3F). Deliberately never feeds acknowledgedFindingIds or
 * any part of the deterministic gate above — its findings are advisory-only informational
 * reading, shown alongside the review panel, never something the user has to acknowledge or
 * clear to submit.
 */
type AiCheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; findings: Finding[] }
  | { kind: 'no_claims_to_check' }
  | { kind: 'unavailable' };

/**
 * The dashboard's consistency-review flow for marking an application applied
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.2H) — the dedicated path alongside (not replacing) the
 * generic status control, which no longer offers APPLIED as a plain dropdown option. Mirrors the
 * extension popup's existing pattern: nothing runs until this explicit "Mark as Applied" click,
 * findings are advisory here (fetched from the read-only GET endpoint) and re-verified
 * authoritatively by the server action itself — a stale/forged acknowledgement id sent from here
 * can never bypass a real current finding, since the server recomputes everything from scratch.
 */
export function MarkAppliedPanel({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const [aiCheck, setAiCheck] = useState<AiCheckState>({ kind: 'idle' });

  const checkUnsupportedClaims = async () => {
    setAiCheck({ kind: 'checking' });
    try {
      const res = await fetch(
        `/api/applications/${applicationId}/unsupported-claims-check`,
        {
          method: 'POST',
        },
      );
      if (!res.ok) {
        setAiCheck({ kind: 'unavailable' });
        return;
      }
      const body = (await res.json()) as
        | { status: 'ok'; findings: Finding[] }
        | { status: 'no_claims_to_check'; findings: Finding[] }
        | { status: 'unavailable'; findings: Finding[] };
      if (body.status === 'unavailable') {
        setAiCheck({ kind: 'unavailable' });
      } else if (body.status === 'no_claims_to_check') {
        setAiCheck({ kind: 'no_claims_to_check' });
      } else {
        setAiCheck({ kind: 'result', findings: body.findings });
      }
    } catch {
      setAiCheck({ kind: 'unavailable' });
    }
  };

  const startReview = async () => {
    setState({ kind: 'checking' });
    setAiCheck({ kind: 'idle' });
    try {
      const res = await fetch(`/api/applications/${applicationId}/consistency-check`);
      if (!res.ok) {
        setState({
          kind: 'error',
          message: 'Could not check this application for consistency issues.',
        });
        return;
      }
      const body = (await res.json()) as { findings: Finding[] };
      if (body.findings.length === 0) {
        // Clean — skip straight to confirming, same as before this phase existed.
        await submit(new Set());
        return;
      }
      setState({ kind: 'review', findings: body.findings, acknowledged: new Set() });
    } catch {
      setState({
        kind: 'error',
        message: 'Could not check this application for consistency issues.',
      });
    }
  };

  const submit = async (acknowledged: Set<string>) => {
    setState((prev) =>
      prev.kind === 'review'
        ? { kind: 'submitting', findings: prev.findings, acknowledged }
        : { kind: 'submitting', findings: [], acknowledged },
    );
    const result = await markApplicationApplied(applicationId, [...acknowledged]);
    if (result.status === 'ok') {
      setState({ kind: 'idle' });
      router.refresh();
      return;
    }
    if (result.status === 'consistency_check_failed') {
      // The authoritative server-side recomputation found something a moment later — always
      // re-render exactly what it says, never what this component last fetched.
      setState({
        kind: 'review',
        findings: result.findings as Finding[],
        acknowledged: new Set(),
      });
      return;
    }
    setState({ kind: 'error', message: result.message });
  };

  if (state.kind === 'idle') {
    return (
      <Button type="button" variant="outline" size="sm" onClick={startReview}>
        Mark as Applied
      </Button>
    );
  }

  if (state.kind === 'checking') {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        Checking…
      </Button>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-destructive text-sm">{state.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={startReview}>
          Try again
        </Button>
      </div>
    );
  }

  const blocking = state.findings.filter((f) => f.severity === 'BLOCKING');
  const warnings = state.findings.filter((f) => f.severity === 'WARNING');
  const submitting = state.kind === 'submitting';
  const allWarningsAcknowledged = warnings.every((f) => state.acknowledged.has(f.id));

  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Review before marking applied</h3>

      {blocking.length > 0 ? (
        <div className="space-y-2">
          {blocking.map((finding) => (
            <div
              key={finding.id}
              className="border-destructive/40 bg-destructive/5 rounded-md border p-3"
            >
              <p className="text-destructive text-sm font-medium">
                Contradiction — cannot submit as-is
              </p>
              <p className="text-muted-foreground mt-1 text-sm">{finding.description}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                &ldquo;{finding.fieldALabel}&rdquo; = {finding.fieldAValue} vs. &ldquo;
                {finding.fieldBLabel}&rdquo; = {finding.fieldBValue}
              </p>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Fix the underlying answer (edit the conflicting generated answer, or update
            your profile) and check again — a contradiction like this can&apos;t be
            acknowledged away.
          </p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-2">
          {warnings.map((finding) => (
            <label
              key={finding.id}
              className="border-border flex items-start gap-2 rounded-md border p-3 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={state.acknowledged.has(finding.id)}
                disabled={submitting}
                onChange={(e) => {
                  const next = new Set(state.acknowledged);
                  if (e.target.checked) next.add(finding.id);
                  else next.delete(finding.id);
                  setState({
                    kind: 'review',
                    findings: state.findings,
                    acknowledged: next,
                  });
                }}
              />
              <span>
                <span className="block">{finding.description}</span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  &ldquo;{finding.fieldALabel}&rdquo; = {finding.fieldAValue} vs. &ldquo;
                  {finding.fieldBLabel}&rdquo; = {finding.fieldBValue}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="border-border space-y-2 rounded-md border border-dashed p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Optional: have AI check your approved answers for claims your profile
            doesn&apos;t back up. Advisory only — nothing here is required to submit.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={aiCheck.kind === 'checking' || submitting}
            onClick={checkUnsupportedClaims}
          >
            {aiCheck.kind === 'checking' ? 'Checking…' : 'Check unsupported claims'}
          </Button>
        </div>

        {aiCheck.kind === 'result' && aiCheck.findings.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No unsupported claims found in your approved answers.
          </p>
        ) : null}

        {aiCheck.kind === 'result' && aiCheck.findings.length > 0 ? (
          <div className="space-y-2">
            {aiCheck.findings.map((finding) => (
              <div key={finding.id} className="bg-muted/50 rounded-md p-3 text-sm">
                <p className="font-medium">&ldquo;{finding.fieldALabel}&rdquo;</p>
                <p className="text-muted-foreground mt-1">{finding.description}</p>
              </div>
            ))}
          </div>
        ) : null}

        {aiCheck.kind === 'no_claims_to_check' ? (
          <p className="text-muted-foreground text-xs">
            Nothing to check yet — no approved answers or approved facts.
          </p>
        ) : null}

        {aiCheck.kind === 'unavailable' ? (
          <p className="text-muted-foreground text-xs">
            This check is unavailable right now. You can still submit — it never blocks.
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={blocking.length > 0 || !allWarningsAcknowledged || submitting}
          onClick={() => submit(state.acknowledged)}
        >
          {submitting ? 'Marking…' : 'Confirm — Mark as Applied'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => setState({ kind: 'idle' })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
