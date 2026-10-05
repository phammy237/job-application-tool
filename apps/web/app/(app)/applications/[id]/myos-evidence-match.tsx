import {
  matchRequirementsToEvidence,
  safeHttpHref,
  type EvidenceGraphData,
  type RequirementInput,
  type RequirementLevel,
  type RequirementMatchSummary,
  type SupportIndex,
} from '@career-os/shared';
import Link from 'next/link';
import type { RequirementSource } from '../../../../lib/myos/application-requirements';
import { entityHref, ProvenanceBadge } from '../../../../lib/myos/provenance-badge';
import { TONE_PANEL, type Tone } from '../../my/_components/tones';
import { TonePill } from '../../my/_components/badges';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
} from '../../my/_components/collapsible';

const LEVEL: Record<RequirementLevel, { tone: Tone; label: string }> = {
  STRONG: { tone: 'success', label: 'Strong' },
  MODERATE: { tone: 'primary', label: 'Moderate' },
  LIMITED: { tone: 'warning', label: 'Limited' },
  NONE: { tone: 'danger', label: 'No evidence' },
};

const SOURCE_NOTE: Record<RequirementSource, string> = {
  ANALYSIS_RUN: 'Requirements come from your current requirement analysis.',
  POSTING_LISTS: 'Requirements come from the job posting qualification lists.',
  EXTRACTED_FROM_TEXT:
    'Requirements were pulled from the posting text by simple rules, so some may be missed or imprecise.',
  NONE: '',
};

export function verdictCopy(summary: RequirementMatchSummary): {
  title: string;
  body: string;
} {
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
  supportIndex,
  requirements,
  source,
}: {
  graph: EvidenceGraphData;
  /** Prebuilt `buildSupportIndex(graph)` shared with sibling panels. */
  supportIndex?: SupportIndex;
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
        <h2
          id="myos-evidence-match-heading"
          className="text-muted-foreground text-sm font-medium"
        >
          Evidence match
        </h2>
        <p className="text-muted-foreground text-xs">
          Computed from your own myOS evidence. No AI is used and no AI quota is consumed.
        </p>
      </div>

      {graphEmpty ? (
        <div className={`rounded-lg border p-3 text-sm ${TONE_PANEL.muted}`}>
          <p>Your evidence graph is empty, so nothing can be matched yet.</p>
          <Link href="/my" className="text-primary underline underline-offset-2">
            Set up myOS
          </Link>
        </div>
      ) : requirements.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No requirements could be read from this job posting, so there is nothing to
          match.
        </p>
      ) : (
        <MatchBody
          graph={graph}
          supportIndex={supportIndex}
          requirements={requirements}
          source={source}
        />
      )}
    </section>
  );
}

function MatchBody({
  graph,
  supportIndex,
  requirements,
  source,
}: {
  graph: EvidenceGraphData;
  supportIndex?: SupportIndex;
  requirements: RequirementInput[];
  source: RequirementSource;
}) {
  const result = matchRequirementsToEvidence(
    graph,
    requirements,
    new Date(),
    supportIndex,
  );
  const verdict = verdictCopy(result.summary);
  const s = result.summary;
  return (
    <>
      <div
        role="status"
        className={`rounded-lg border p-3 text-sm ${
          s.overallVerdict === 'WEAK_FIT' ? TONE_PANEL.danger : TONE_PANEL.neutral
        }`}
      >
        <p className="font-medium">{verdict.title}</p>
        <p className="text-muted-foreground mt-1 text-xs">{verdict.body}</p>
        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <TonePill tone="success">{s.strong} strong</TonePill>
          <TonePill tone="primary">{s.moderate} moderate</TonePill>
          <TonePill tone="warning">{s.limited} limited</TonePill>
          <TonePill tone="danger">{s.none} with no evidence</TonePill>
        </p>
        {SOURCE_NOTE[source] ? (
          <p className="text-muted-foreground mt-2 text-xs">{SOURCE_NOTE[source]}</p>
        ) : null}
      </div>

      <CollapsibleGroup>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Requirements ({result.matches.length})</h3>
          <CollapsibleGroupControls label="requirements" />
        </div>
        <ul className="mt-2 space-y-2">
          {result.matches.map((m) => (
            <li key={m.requirementId}>
              <Collapsible
                variant="row"
                headingLevel={4}
                title={m.requirementText}
                meta={
                  <TonePill tone={LEVEL[m.level].tone} dot>
                    {LEVEL[m.level].label}
                  </TonePill>
                }
                summary={
                  m.gap
                    ? `${m.category === 'REQUIRED' ? 'Required' : 'Preferred'} · gap`
                    : `${m.category === 'REQUIRED' ? 'Required' : 'Preferred'} · ${m.supports.length} supporting item${m.supports.length === 1 ? '' : 's'}`
                }
                defaultOpen={m.gap && m.category === 'REQUIRED'}
                contentClassName="space-y-2 text-sm"
              >
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
                        <li
                          key={`${sup.entityType}:${sup.entityId}`}
                          className="space-y-1 text-xs"
                        >
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              href={entityHref(sup.entityType, sup.entityId)}
                              className="text-primary font-medium underline underline-offset-2"
                            >
                              {sup.name}
                            </Link>
                            <span className="text-muted-foreground">
                              {sup.entityType.toLowerCase()} · matched by{' '}
                              {sup.via === 'skill-edge' ? 'linked skill' : 'text overlap'}
                            </span>
                            {sup.unconfirmed ? (
                              <TonePill tone="warning">unconfirmed</TonePill>
                            ) : null}
                          </p>
                          {sup.evidence.length > 0 ? (
                            <ul className="flex flex-wrap gap-1.5 pl-3">
                              {sup.evidence.map((ev) => {
                                const href = safeHttpHref(ev.sourceUrl);
                                return (
                                  <li
                                    key={ev.evidenceId}
                                    className="flex items-center gap-1"
                                  >
                                    {href ? (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-primary underline"
                                      >
                                        {ev.title}
                                        <span className="sr-only">
                                          {' '}
                                          (opens in a new tab)
                                        </span>
                                      </a>
                                    ) : (
                                      <span>{ev.title}</span>
                                    )}
                                    <ProvenanceBadge
                                      sourceType={ev.sourceType}
                                      verificationState={ev.verificationState}
                                    />
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="text-muted-foreground pl-3">
                              No linked evidence yet.
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {m.level === 'LIMITED' ? (
                      <p className="text-xs">
                        <Link
                          href="/my/projects"
                          className="text-primary underline underline-offset-2"
                        >
                          Add evidence
                        </Link>{' '}
                        to strengthen this.
                      </p>
                    ) : null}
                  </>
                )}
              </Collapsible>
            </li>
          ))}
        </ul>
      </CollapsibleGroup>
    </>
  );
}
