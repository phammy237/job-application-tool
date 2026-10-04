import {
  matchRequirementsToEvidence,
  type EvidenceGraphData,
  type RequirementInput,
  type RequirementLevel,
  type RequirementMatchSummary,
} from '@career-os/shared';
import Link from 'next/link';
import type { RequirementSource } from '../../../../lib/myos/application-requirements';
import { entityHref, ProvenanceBadge } from '../../../../lib/myos/provenance-badge';

const LEVEL_CLASS: Record<RequirementLevel, string> = {
  STRONG: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  MODERATE: 'border-sky-500/50 text-sky-700 dark:text-sky-400',
  LIMITED: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  NONE: 'border-destructive/50 text-destructive',
};

const SOURCE_NOTE: Record<RequirementSource, string> = {
  ANALYSIS_RUN: 'Requirements come from your current requirement analysis.',
  POSTING_LISTS: 'Requirements come from the job posting qualification lists.',
  EXTRACTED_FROM_TEXT:
    'Requirements were pulled from the posting text by simple rules, so some may be missed or imprecise.',
  NONE: '',
};

export function verdictCopy(summary: RequirementMatchSummary): { title: string; body: string } {
  switch (summary.overallVerdict) {
    case 'STRONG_FIT':
      return {
        title: 'Strong fit on recorded evidence',
        body: 'Your approved evidence backs the requirements below, and no required item is a gap. Review each row before relying on it.',
      };
    case 'PARTIAL_FIT':
      return {
        title: 'Partial fit on recorded evidence',
        body: `Some requirements are backed and others are not (${summary.requiredGaps.length} required gap${summary.requiredGaps.length === 1 ? '' : 's'}). Do not claim the gaps in an application unless you add real evidence.`,
      };
    case 'WEAK_FIT':
      return {
        title: 'Weak fit on recorded evidence',
        body: 'Most requirements have little or no backing in your recorded evidence. This reflects what is stored in myOS, not necessarily your experience: if you have relevant work that is missing, add it. Otherwise treat this role as a stretch.',
      };
  }
}

/**
 * Deterministic "evidence match" for one application. No LLM, no AI quota: pure matching of the
 * job's requirements against the user's own evidence graph. Complements (does not replace) the
 * AI requirement-analysis panel.
 */
export function MyosEvidenceMatch({
  graph,
  requirements,
  source,
}: {
  graph: EvidenceGraphData;
  requirements: RequirementInput[];
  source: RequirementSource;
}) {
  const graphEmpty =
    graph.projects.length === 0 &&
    graph.experiences.length === 0 &&
    graph.achievements.length === 0 &&
    graph.stories.length === 0 &&
    graph.evidence.length === 0;

  return (
    <section className="space-y-3" aria-labelledby="myos-evidence-match-heading">
      <div>
        <h2 id="myos-evidence-match-heading" className="text-muted-foreground text-sm font-medium">
          Evidence match
        </h2>
        <p className="text-muted-foreground text-xs">
          Computed from your own myOS evidence. No AI is used and no AI quota is consumed.
        </p>
      </div>

      {graphEmpty ? (
        <div className="border-border rounded-lg border p-3 text-sm">
          <p>Your evidence graph is empty, so nothing can be matched yet.</p>
          <Link href="/my" className="text-primary underline underline-offset-2">
            Set up myOS
          </Link>
        </div>
      ) : requirements.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No requirements could be read from this job posting, so there is nothing to match.
        </p>
      ) : (
        <MatchBody graph={graph} requirements={requirements} source={source} />
      )}
    </section>
  );
}

function MatchBody({
  graph,
  requirements,
  source,
}: {
  graph: EvidenceGraphData;
  requirements: RequirementInput[];
  source: RequirementSource;
}) {
  const result = matchRequirementsToEvidence(graph, requirements, new Date());
  const verdict = verdictCopy(result.summary);
  const s = result.summary;
  return (
    <>
      <div
        role="status"
        className={`rounded-lg border p-3 text-sm ${
          s.overallVerdict === 'WEAK_FIT' ? 'border-destructive/50' : 'border-border'
        }`}
      >
        <p className="font-medium">{verdict.title}</p>
        <p className="text-muted-foreground mt-1 text-xs">{verdict.body}</p>
        <p className="text-muted-foreground mt-2 text-xs">
          {s.strong} strong, {s.moderate} moderate, {s.limited} limited, {s.none} with no evidence.{' '}
          {SOURCE_NOTE[source]}
        </p>
      </div>

      <ul className="space-y-3">
        {result.matches.map((m) => (
          <li key={m.requirementId} className="border-border space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p>
                {m.requirementText}
                <span className="text-muted-foreground ml-2 text-xs">
                  {m.category === 'REQUIRED' ? 'required' : 'preferred'}
                </span>
              </p>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${LEVEL_CLASS[m.level]}`}
              >
                {m.level}
              </span>
            </div>

            {m.gap ? (
              <p className="text-destructive text-xs">
                No meaningful evidence found.{' '}
                <Link href="/my/projects" className="underline underline-offset-2">
                  Add evidence
                </Link>
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">{m.explanation}</p>
                <ul className="space-y-2">
                  {m.supports.map((sup) => (
                    <li key={`${sup.entityType}:${sup.entityId}`} className="space-y-1 text-xs">
                      <p>
                        <Link
                          href={entityHref(sup.entityType, sup.entityId)}
                          className="text-primary underline underline-offset-2"
                        >
                          {sup.name}
                        </Link>
                        <span className="text-muted-foreground ml-2">
                          {sup.entityType.toLowerCase()} · matched by{' '}
                          {sup.via === 'skill-edge' ? 'linked skill' : 'text overlap'}
                        </span>
                        {sup.unconfirmed ? (
                          <span className="ml-2 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                            unconfirmed
                          </span>
                        ) : null}
                      </p>
                      {sup.evidence.length > 0 ? (
                        <ul className="flex flex-wrap gap-1 pl-3">
                          {sup.evidence.map((ev) => (
                            <li key={ev.evidenceId} className="flex items-center gap-1">
                              {ev.sourceUrl ? (
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-primary underline"
                                >
                                  {ev.title}
                                </a>
                              ) : (
                                <span>{ev.title}</span>
                              )}
                              <ProvenanceBadge
                                sourceType={ev.sourceType}
                                verificationState={ev.verificationState}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground pl-3">No linked evidence yet.</p>
                      )}
                    </li>
                  ))}
                </ul>
                {m.level === 'LIMITED' ? (
                  <p className="text-xs">
                    <Link href="/my/projects" className="text-primary underline underline-offset-2">
                      Add evidence
                    </Link>{' '}
                    to strengthen this.
                  </p>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
