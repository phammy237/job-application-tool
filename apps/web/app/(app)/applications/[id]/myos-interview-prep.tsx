import {
  buildInterviewPrep,
  competencyLabel,
  type EvidenceGraphData,
  type InterviewJobInput,
  type SupportIndex,
} from '@career-os/shared';
import Link from 'next/link';

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

  return (
    <section className="space-y-3" aria-labelledby="myos-interview-prep-heading">
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

      {empty ? (
        <p className="text-muted-foreground text-sm">
          Nothing in your myOS evidence relates to this role yet.{' '}
          <Link href="/my" className="text-primary underline underline-offset-2">
            Add stories and projects
          </Link>
        </p>
      ) : null}

      {prep.competencyAreas.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Competency areas</h3>
          <ul className="space-y-2">
            {prep.competencyAreas.map((area) => (
              <li
                key={area.competency}
                className="border-border space-y-1 rounded-lg border p-3 text-sm"
              >
                <p className="font-medium">
                  {competencyLabel(area.competency)}
                  {area.gap ? (
                    <span className="text-destructive ml-2 text-xs font-normal">gap</span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">{area.rationale}</p>
                {area.stories.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {area.stories.map((s) => (
                      <li key={s.storyId}>
                        <Link
                          href={`/my/stories/${s.storyId}`}
                          className="text-primary underline underline-offset-2"
                        >
                          {s.title}
                        </Link>
                        <span className="text-muted-foreground ml-2">
                          {s.strength.toLowerCase()}
                        </span>
                        {s.unapproved ? (
                          <span className="ml-2 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                            not approved yet
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-destructive text-xs">No story covers this yet.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {prep.relevantProjects.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Relevant projects</h3>
          <ul className="space-y-1 text-sm">
            {prep.relevantProjects.map((p) => (
              <li key={p.projectId}>
                <Link
                  href={`/my/projects/${p.projectId}`}
                  className="text-primary underline underline-offset-2"
                >
                  {p.name}
                </Link>
                <span className="text-muted-foreground ml-2 text-xs">
                  {p.level.toLowerCase()} support for {p.requirementIds.length}{' '}
                  requirement
                  {p.requirementIds.length === 1 ? '' : 's'}
                </span>
                {p.unconfirmed ? (
                  <span className="ml-2 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                    unconfirmed
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <TalkingPoints
        title="Technical talking points"
        points={prep.technicalTalkingPoints}
      />
      <TalkingPoints title="Product talking points" points={prep.productTalkingPoints} />

      {prep.gaps.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Gaps to be ready for</h3>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
            {prep.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {prep.questionsToPrepare.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Questions to prepare</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {prep.questionsToPrepare.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-muted-foreground text-xs">
        Your own stored talking points, quoted as written.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs">
        {points.map((p) => (
          <li key={`${p.projectId}:${p.text}`}>{p.text}</li>
        ))}
      </ul>
    </div>
  );
}
