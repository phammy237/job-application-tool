import {
  DEFAULT_MAX_NODES,
  buildEvidenceGraph,
  buildGraphIndex,
  buildSupportIndex,
  buildTimeline,
  computeAllSkillStrengths,
  evidenceCoverage,
} from '@career-os/shared';
import { notFound } from 'next/navigation';
import { MyosEvidenceMatch } from '../../(app)/applications/[id]/myos-evidence-match';
import { MyosInterviewPrep } from '../../(app)/applications/[id]/myos-interview-prep';
import { StrengthBadge, VerificationBadge } from '../../(app)/my/_components/badges';
import { GraphView } from '../../(app)/my/graph/graph-view';
import { PreviewAsk } from './preview-ask';
import { SAMPLE_GRAPH, SAMPLE_JOB } from './sample-graph';

export const metadata = { title: 'myOS preview (sample data)' };
// Never prerender: the NODE_ENV gate must be evaluated per request.
export const dynamic = 'force-dynamic';

/**
 * DEV-ONLY preview of the myOS views over FICTIONAL sample data, for inspecting the UI when
 * Supabase is unavailable. Returns 404 outside `next dev`. Reads no database and no user data, so
 * it is safe outside the authenticated (app) group (CLAUDE.md public/private boundary).
 */
export default function MyosPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();

  const graph = SAMPLE_GRAPH;
  const now = new Date();
  const index = buildGraphIndex(graph);
  const strengths = computeAllSkillStrengths(graph, now, index);
  const coverage = evidenceCoverage(index);
  const timeline = buildTimeline(index, { now });
  const viz = buildEvidenceGraph(graph, { maxNodes: DEFAULT_MAX_NODES });
  const supportIndex = buildSupportIndex(graph);

  const sections = [
    ['overview', 'Overview'],
    ['skills', 'Skills'],
    ['timeline', 'Timeline'],
    ['graph', 'Graph'],
    ['ask', 'Ask'],
    ['job', 'Job match & interview prep'],
  ];

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl space-y-10 px-4 py-6">
        <div
          role="note"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <strong>Dev preview — sample data.</strong> Everything below is fictional and computed
          locally; nothing is read from or saved to Supabase. Links into /my need a real login.
        </div>

        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">myOS preview</h1>
          <nav aria-label="Preview sections" className="flex flex-wrap gap-2 text-sm">
            {sections.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="hover:bg-accent rounded-md border px-3 py-1.5"
              >
                {label}
              </a>
            ))}
          </nav>
        </header>

        <section id="overview" aria-labelledby="h-overview" className="space-y-3">
          <h2 id="h-overview" className="text-lg font-semibold">
            What Career OS knows
          </h2>
          <p className="text-sm">
            {graph.projects.length} projects ({graph.projects.filter((p) => !p.userApproved).length}{' '}
            unconfirmed), {graph.skills.length} skills, {graph.experiences.length} experiences,{' '}
            {graph.achievements.length} achievements, {graph.stories.length} stories and{' '}
            {graph.evidence.length} evidence items.
          </p>
          <p className="text-muted-foreground text-sm">
            Evidence coverage: {coverage.covered} of {coverage.total} projects, achievements and
            stories have linked evidence.
          </p>
          {coverage.gaps.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {coverage.gaps.map((g) => (
                <li key={`${g.type}:${g.id}`}>{g.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section id="skills" aria-labelledby="h-skills" className="space-y-3">
          <h2 id="h-skills" className="text-lg font-semibold">
            Skills
          </h2>
          <ul className="divide-y rounded-md border">
            {strengths.map(({ skill, strength }) => (
              <li key={skill.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{skill.name}</span>
                  <StrengthBadge level={strength.level} />
                  <span className="text-muted-foreground text-xs">
                    {strength.evidenceCount} evidence ({strength.verifiedEvidenceCount} verified)
                    · recency {strength.recency.toLowerCase()}
                  </span>
                </div>
                {strength.reasons.length > 0 && (
                  <p className="text-muted-foreground text-xs">{strength.reasons.join(' ')}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="timeline" aria-labelledby="h-timeline" className="space-y-3">
          <h2 id="h-timeline" className="text-lg font-semibold">
            Timeline
          </h2>
          <ol className="space-y-2">
            {timeline.entries.map((e) => (
              <li key={e.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground w-28 shrink-0 text-xs">
                    {e.start ?? '—'} → {e.isOngoing ? 'Present' : (e.end ?? '—')}
                  </span>
                  <span className="font-medium">{e.title}</span>
                  {e.subtitle && <span className="text-muted-foreground">· {e.subtitle}</span>}
                  <VerificationBadge state={e.verificationState} />
                </div>
                {e.relatedSkillNames.length > 0 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {e.relatedSkillNames.join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section id="graph" aria-labelledby="h-graph" className="space-y-3">
          <h2 id="h-graph" className="text-lg font-semibold">
            Evidence graph
          </h2>
          <GraphView viz={viz} />
        </section>

        <section id="ask" aria-labelledby="h-ask" className="space-y-3">
          <h2 id="h-ask" className="text-lg font-semibold">
            Ask my evidence
          </h2>
          <PreviewAsk />
        </section>

        <section id="job" aria-labelledby="h-job" className="space-y-6">
          <h2 id="h-job" className="text-lg font-semibold">
            Sample job: {SAMPLE_JOB.title} at {SAMPLE_JOB.company}
          </h2>
          <MyosEvidenceMatch
            graph={graph}
            supportIndex={supportIndex}
            requirements={SAMPLE_JOB.requirements}
            source="POSTING_LISTS"
          />
          <MyosInterviewPrep
            graph={graph}
            supportIndex={supportIndex}
            job={{
              title: SAMPLE_JOB.title,
              company: SAMPLE_JOB.company,
              description: SAMPLE_JOB.description,
              requirements: SAMPLE_JOB.requirements.map((r) => r.text),
            }}
          />
        </section>
      </div>
    </div>
  );
}
