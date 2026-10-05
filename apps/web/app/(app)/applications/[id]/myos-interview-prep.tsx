import {
  buildInterviewPrep,
  competencyLabel,
  type EvidenceGraphData,
  type InterviewJobInput,
  type SupportIndex,
} from '@career-os/shared';
import Link from 'next/link';
import { TonePill } from '../../my/_components/badges';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
} from '../../my/_components/collapsible';

/**
 * "From your evidence": interview preparation built deterministically from the user's own myOS
 * graph. Everything shown is a stored row (stories, projects, the user's own talking points) or a
 * templated question addressed to the user. Separate from the AI interview-prep panel; uses no
 * AI and no AI quota.
 */
export function MyosInterviewPrep({
  graph,
  supportIndex,
  job,
}: {
  graph: EvidenceGraphData;
  /** Prebuilt `buildSupportIndex(graph)` shared with sibling panels. */
  supportIndex?: SupportIndex;
  job: InterviewJobInput;
}) {
  const prep = buildInterviewPrep(graph, job, new Date(), supportIndex);
  const empty =
    prep.competencyAreas.length === 0 &&
    prep.relevantProjects.length === 0 &&
    prep.questionsToPrepare.length === 0;
  const gapAreas = prep.competencyAreas.filter((a) => a.gap).length;

  return (
    <section className="space-y-3" aria-labelledby="myos-interview-prep-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="myos-interview-prep-heading"
            className="text-muted-foreground text-sm font-medium"
          >
            From your evidence
          </h2>
          <p className="text-muted-foreground text-xs">
            Interview prep from your own stories, projects and talking points. No AI is
            used; this is separate from the AI interview-prep panel.
          </p>
        </div>
      </div>

      {empty ? (
        <p className="text-muted-foreground text-sm">
          Nothing in your myOS evidence relates to this role yet.{' '}
          <Link href="/my" className="text-primary underline underline-offset-2">
            Add stories and projects
          </Link>
        </p>
      ) : (
        <CollapsibleGroup>
          <div className="flex justify-end">
            <CollapsibleGroupControls label="interview prep sections" />
          </div>
          <div className="space-y-2">
            {prep.competencyAreas.length > 0 ? (
              <Collapsible
                variant="row"
                title="Competency areas"
                count={prep.competencyAreas.length}
                summary={
                  gapAreas > 0
                    ? `${gapAreas} without a story yet`
                    : 'Every area has at least one story'
                }
                defaultOpen
              >
                <ul className="divide-border -my-2 divide-y">
                  {prep.competencyAreas.map((area) => (
                    <li key={area.competency} className="space-y-1 py-2.5 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {competencyLabel(area.competency)}
                        {area.gap ? <TonePill tone="danger">gap</TonePill> : null}
                      </p>
                      <p className="text-muted-foreground text-xs">{area.rationale}</p>
                      {area.stories.length > 0 ? (
                        <ul className="space-y-1 text-xs">
                          {area.stories.map((s) => (
                            <li
                              key={s.storyId}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <Link
                                href={`/my/stories/${s.storyId}`}
                                className="text-primary underline underline-offset-2"
                              >
                                {s.title}
                              </Link>
                              <span className="text-muted-foreground">
                                {s.strength.toLowerCase()}
                              </span>
                              {s.unapproved ? (
                                <TonePill tone="warning">not approved yet</TonePill>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-destructive text-xs">
                          No story covers this yet.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}

            {prep.relevantProjects.length > 0 ? (
              <Collapsible
                variant="row"
                title="Relevant projects"
                count={prep.relevantProjects.length}
                defaultOpen
              >
                <ul className="space-y-1.5 text-sm">
                  {prep.relevantProjects.map((p) => (
                    <li key={p.projectId} className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/my/projects/${p.projectId}`}
                        className="text-primary underline underline-offset-2"
                      >
                        {p.name}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {p.level.toLowerCase()} support for {p.requirementIds.length}{' '}
                        requirement
                        {p.requirementIds.length === 1 ? '' : 's'}
                      </span>
                      {p.unconfirmed ? (
                        <TonePill tone="warning">unconfirmed</TonePill>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}

            <TalkingPoints
              title="Technical talking points"
              points={prep.technicalTalkingPoints}
            />
            <TalkingPoints
              title="Product talking points"
              points={prep.productTalkingPoints}
            />

            {prep.gaps.length > 0 ? (
              <Collapsible
                variant="row"
                title="Gaps to be ready for"
                count={prep.gaps.length}
              >
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
                  {prep.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}

            {prep.questionsToPrepare.length > 0 ? (
              <Collapsible
                variant="row"
                title="Questions to prepare"
                count={prep.questionsToPrepare.length}
              >
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {prep.questionsToPrepare.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}
          </div>
        </CollapsibleGroup>
      )}
    </section>
  );
}

function TalkingPoints({
  title,
  points,
}: {
  title: string;
  points: { text: string; projectId: string }[];
}) {
  if (points.length === 0) return null;
  return (
    <Collapsible
      variant="row"
      title={title}
      count={points.length}
      summary="Your own stored talking points, quoted as written."
    >
      <ul className="list-disc space-y-1 pl-5 text-xs">
        {points.map((p) => (
          <li key={`${p.projectId}:${p.text}`}>{p.text}</li>
        ))}
      </ul>
    </Collapsible>
  );
}
