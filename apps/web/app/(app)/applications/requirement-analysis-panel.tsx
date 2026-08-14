'use client';

import { Badge, Button } from '@career-os/ui';
import { useCallback, useEffect, useState } from 'react';
import type {
  RequirementEvidenceMappingWithValidity,
  RequirementMappingRun,
} from '@career-os/shared';

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; run: RequirementMappingRun; mappings: RequirementEvidenceMappingWithValidity[] }
  | { status: 'load-error' };

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'insufficient_facts' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

const RELATIONSHIP_LABEL: Record<string, string> = {
  DIRECT: 'Direct match',
  EQUIVALENT: 'Equivalent match',
  INFERRED: 'Inferred — needs your confirmation',
  MISSING: 'Not covered',
};

const VALIDITY_LABEL: Record<string, string> = {
  valid: 'Currently approved',
  changed_since_analysis: 'Updated since this analysis — regenerate to refresh',
  unapproved: 'No longer approved',
  deleted: 'No longer available',
};

/**
 * The full read/trigger UI for Phase 5A requirement-evidence mapping (docs/IMPLEMENTATION_PLAN.md
 * round-3 §7 / round-4 addendum). Fetches the current run on mount; "Analyze requirements" (or
 * "Regenerate" once a run exists) is the only way generation ever runs — never automatic, never
 * fired on save. Every state below is fully wired to the real GET/POST /api/job-snapshots/:id/
 * requirements endpoints, not a placeholder.
 */
export function RequirementAnalysisPanel({
  jobSnapshotId,
  contentTruncated = false,
  truncatedFields = [],
}: {
  jobSnapshotId: string;
  /** docs/IMPLEMENTATION_PLAN.md round-4 addendum §8 — the captured posting was too long to
   * store in full. Shown as an honest notice, never silently presented as the complete
   * posting. */
  contentTruncated?: boolean;
  truncatedFields?: string[];
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/job-snapshots/${jobSnapshotId}/requirements`);
      if (!response.ok) {
        setLoad({ status: 'load-error' });
        return;
      }
      const body = (await response.json()) as {
        run: RequirementMappingRun | null;
        mappings: RequirementEvidenceMappingWithValidity[];
      };
      setLoad(body.run ? { status: 'ready', run: body.run, mappings: body.mappings } : { status: 'empty' });
    } catch {
      setLoad({ status: 'load-error' });
    }
  }, [jobSnapshotId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const analyze = useCallback(async () => {
    setGeneration({ status: 'generating' });
    try {
      const response = await fetch(`/api/job-snapshots/${jobSnapshotId}/requirements`, {
        method: 'POST',
      });
      const body = (await response.json()) as { status?: string; error?: string };

      if (response.status === 429) {
        setGeneration({ status: 'rate_limited' });
        return;
      }
      if (body.status === 'insufficient_facts') {
        setGeneration({ status: 'insufficient_facts' });
        return;
      }
      if (!response.ok || body.status === 'validation_failed') {
        setGeneration({ status: 'error', message: body.error ?? 'Analysis failed. Try again.' });
        return;
      }

      setGeneration({ status: 'idle' });
      await refresh();
    } catch {
      setGeneration({ status: 'error', message: 'Analysis failed. Try again.' });
    }
  }, [jobSnapshotId, refresh]);

  const isGenerating = generation.status === 'generating';
  const hasRun = load.status === 'ready';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Requirements &amp; evidence</h2>
        <Button variant="outline" size="sm" disabled={isGenerating || load.status === 'loading'} onClick={() => void analyze()}>
          {isGenerating ? 'Analyzing…' : hasRun ? 'Regenerate' : 'Analyze requirements'}
        </Button>
      </div>

      {contentTruncated ? (
        <p className="text-muted-foreground text-xs">
          This posting was too long to store in full — showing a truncated version
          {truncatedFields.length > 0 ? ` (${truncatedFields.join(', ')})` : ''}.
        </p>
      ) : null}

      {generation.status === 'insufficient_facts' ? (
        <p className="text-muted-foreground text-sm">
          You don&apos;t have any approved facts yet — approve some in your profile first.
        </p>
      ) : null}
      {generation.status === 'rate_limited' ? (
        <p className="text-muted-foreground text-sm">You&apos;ve reached your AI request limit for this period.</p>
      ) : null}
      {generation.status === 'error' ? (
        <p className="text-destructive text-sm">{generation.message}</p>
      ) : null}

      {load.status === 'loading' ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {load.status === 'load-error' ? (
        <p className="text-destructive text-sm">Could not load requirement analysis.</p>
      ) : null}
      {load.status === 'empty' ? (
        <p className="text-muted-foreground text-sm">No requirement analysis yet.</p>
      ) : null}

      {load.status === 'ready' ? <MappingList mappings={load.mappings} /> : null}
    </section>
  );
}

function MappingList({ mappings }: { mappings: RequirementEvidenceMappingWithValidity[] }) {
  const required = mappings.filter((m) => m.requiredOrPreferred === 'REQUIRED');
  const preferred = mappings.filter((m) => m.requiredOrPreferred === 'PREFERRED');

  return (
    <div className="space-y-4">
      {required.length > 0 ? <MappingGroup title="Required" mappings={required} /> : null}
      {preferred.length > 0 ? <MappingGroup title="Preferred" mappings={preferred} /> : null}
    </div>
  );
}

function MappingGroup({ title, mappings }: { title: string; mappings: RequirementEvidenceMappingWithValidity[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
      <ul className="space-y-2">
        {mappings.map((mapping) => (
          <li key={mapping.id} className="border-border rounded-md border px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{mapping.requirementText}</p>
                {mapping.requirementCategory ? (
                  <p className="text-muted-foreground text-xs">{mapping.requirementCategory}</p>
                ) : null}
              </div>
              <Badge variant={mapping.relationship === 'MISSING' ? 'outline' : 'secondary'}>
                {RELATIONSHIP_LABEL[mapping.relationship]}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">{mapping.explanation}</p>
            {mapping.matchedFacts.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {mapping.matchedFacts.map((fact) => (
                  <li key={`${fact.sourceTable}:${fact.factId}`} className="text-muted-foreground text-xs">
                    {VALIDITY_LABEL[fact.validity]}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
