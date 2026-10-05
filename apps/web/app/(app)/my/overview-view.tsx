import {
  buildGraphIndex,
  computeAllSkillStrengths,
  evidenceCoverage,
  type CoverageGap,
  type EvidenceGraphData,
  type GithubConnection,
  type GithubSyncRun,
  type MyosCandidate,
} from '@career-os/shared';
import { buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import {
  buildChecklist,
  buildSnapshot,
  buildUnknowns,
  formatDate,
  isNearlyEmpty,
} from '../../../lib/myos/home';
import {
  EmptyState,
  FlagBadge,
  StrengthBadge,
  VerificationBadge,
} from './_components/badges';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
} from './_components/collapsible';
import { PageHeader } from './_components/page-header';

function sortByRecent<T>(items: T[], date: (item: T) => string | null): T[] {
  return [...items].sort((a, b) => (date(b) ?? '').localeCompare(date(a) ?? ''));
}

function gapHref(gap: CoverageGap, graph: EvidenceGraphData): string {
  if (gap.type === 'PROJECT') return `/my/projects/${gap.id}`;
  if (gap.type === 'ACHIEVEMENT') {
    const projectId = graph.achievements.find((a) => a.id === gap.id)?.projectId;
    return projectId ? `/my/projects/${projectId}` : '/my/achievements';
  }
  return '/my/stories';
}

const linkCls =
  'text-primary focus-visible:ring-ring inline-flex min-h-10 items-center rounded-md px-1 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2';
const rowCls = 'flex min-h-10 items-center justify-between gap-2 py-1.5';
const listCls = 'divide-border -my-1.5 divide-y text-sm';

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="border-border bg-card hover:bg-accent focus-visible:ring-ring block rounded-lg border px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2"
    >
      <span className="block text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </Link>
  );
}

export interface OverviewViewProps {
  graph: EvidenceGraphData;
  pending: MyosCandidate[];
  connection: GithubConnection | null;
  repoCount: number;
  selectedRepoCount: number;
  lastRun: GithubSyncRun | null;
  now?: Date;
}

/** /my overview. Pure presentation over already-loaded, session-scoped data. */
export function OverviewView({
  graph,
  pending,
  connection,
  repoCount,
  selectedRepoCount,
  lastRun,
  now = new Date(),
}: OverviewViewProps) {
  const snapshot = buildSnapshot(graph);
  const index = buildGraphIndex(graph);
  const coverage = evidenceCoverage(index);
  const checklist = buildChecklist(graph, connection, pending);
  const unknowns = buildUnknowns(graph, connection);
  const nearlyEmpty = isNearlyEmpty(snapshot);
  const doneSteps = checklist.filter((c) => c.done).length;

  const strengths = computeAllSkillStrengths(graph, now, index)
    .filter((s) => s.strength.level !== 'NONE')
    .slice(0, 6);
  const recentProjects = sortByRecent(graph.projects, (p) => p.startDate).slice(0, 5);
  const recentAchievements = sortByRecent(
    graph.achievements,
    (a) => a.occurredOn ?? a.createdAt,
  ).slice(0, 5);
  const readyStories = graph.stories.filter((s) => s.userApproved).slice(0, 5);
  const evidenceCountByProject = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.fromType === 'EVIDENCE' && e.toType === 'PROJECT') {
      evidenceCountByProject.set(e.toId, (evidenceCountByProject.get(e.toId) ?? 0) + 1);
    }
  }
  const pendingByProject = new Map<string, number>();
  for (const c of pending) {
    if (c.projectId)
      pendingByProject.set(c.projectId, (pendingByProject.get(c.projectId) ?? 0) + 1);
  }
  const projectName = new Map(graph.projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="What does Career OS know about me?"
        description={<span data-testid="myos-snapshot">{snapshot.sentence}</span>}
        actions={
          <Link href="/my/projects" className={buttonVariants({ size: 'sm' })}>
            Review projects
          </Link>
        }
      />

      <nav aria-label="Counts" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Projects" value={snapshot.counts.projects} href="/my/projects" />
        <Stat label="Skills" value={snapshot.counts.skills} href="/my/skills" />
        <Stat
          label="Experience"
          value={snapshot.counts.experiences}
          href="/my/timeline"
        />
        <Stat
          label="Achievements"
          value={snapshot.counts.achievements}
          href="/my/achievements"
        />
        <Stat label="Stories" value={snapshot.counts.stories} href="/my/stories" />
        <Stat label="Evidence" value={snapshot.counts.evidence} href="/my/graph" />
      </nav>

      <CollapsibleGroup>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Sections</h2>
          <CollapsibleGroupControls label="overview sections" />
        </div>

        <div className="mt-2 space-y-3">
          <Collapsible
            title="Get started"
            count={checklist.length - doneSteps}
            summary={`${doneSteps} of ${checklist.length} steps done`}
            headingLevel={2}
            defaultOpen={nearlyEmpty}
            storageKey="overview:get-started"
          >
            <ol className="space-y-1">
              {checklist.map((item) => (
                <li key={item.step} className="flex items-start gap-3 py-1 text-sm">
                  <span
                    aria-hidden="true"
                    className={
                      item.done
                        ? 'bg-primary text-primary-foreground mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs'
                        : 'border-border text-muted-foreground mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs'
                    }
                  >
                    {item.done ? '✓' : item.step}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={item.href}
                      className={`font-medium hover:underline ${item.done ? 'text-muted-foreground line-through' : ''}`}
                    >
                      {item.label}
                    </Link>
                    <span className="sr-only">
                      {item.done ? ' (done)' : ' (not done)'}
                    </span>
                    <p className="text-muted-foreground text-xs">{item.hint}</p>
                  </div>
                </li>
              ))}
            </ol>
            {unknowns.length > 0 ? (
              <p className="border-border text-muted-foreground mt-3 border-t pt-3 text-sm">
                What Career OS does{' '}
                <span className="text-foreground font-medium">not</span> know right now:{' '}
                {unknowns.join('; ')}. It will not guess, and it never invents facts to
                fill these gaps.
              </p>
            ) : null}
          </Collapsible>

          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <Collapsible
              title="Evidence coverage"
              count={coverage.gaps.length}
              summary={
                coverage.total === 0
                  ? 'Nothing to cover yet'
                  : `${coverage.covered} of ${coverage.total} items have linked evidence`
              }
              meta={
                <Link href="/my/projects" className={linkCls}>
                  Projects
                </Link>
              }
              headingLevel={2}
              defaultOpen
              storageKey="overview:coverage"
            >
              {coverage.total === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No projects, achievements, or stories to cover yet.
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2 text-xs">
                    Projects {coverage.byType.PROJECT.covered}/
                    {coverage.byType.PROJECT.total}, achievements{' '}
                    {coverage.byType.ACHIEVEMENT.covered}/
                    {coverage.byType.ACHIEVEMENT.total}, stories{' '}
                    {coverage.byType.STORY.covered}/{coverage.byType.STORY.total} have at
                    least one linked evidence item.
                  </p>
                  {coverage.gaps.length > 0 ? (
                    <ul className={listCls}>
                      {coverage.gaps.slice(0, 6).map((gap) => (
                        <li key={`${gap.type}-${gap.id}`} className={rowCls}>
                          <span className="min-w-0 truncate">{gap.message}</span>
                          <Link
                            href={gapHref(gap, graph)}
                            className={`${linkCls} shrink-0`}
                          >
                            Fix
                          </Link>
                        </li>
                      ))}
                      {coverage.gaps.length > 6 ? (
                        <li className="text-muted-foreground py-1.5 text-xs">
                          and {coverage.gaps.length - 6} more
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="text-sm">Everything has at least one evidence item.</p>
                  )}
                </>
              )}
            </Collapsible>

            <Collapsible
              id="suggestions"
              title="Suggestions waiting for you"
              count={pending.length}
              summary={
                pending.length === 0
                  ? 'No pending suggestions'
                  : 'Inferred, not yet part of your profile'
              }
              headingLevel={2}
              defaultOpen={pending.length > 0}
              storageKey="overview:suggestions"
            >
              {pending.length === 0 ? (
                <p className="text-muted-foreground text-sm">No pending suggestions.</p>
              ) : (
                <ul className={listCls}>
                  {[...pendingByProject.entries()].slice(0, 5).map(([projectId, n]) => (
                    <li key={projectId} className={rowCls}>
                      <span className="min-w-0 truncate">
                        {projectName.get(projectId) ?? 'Project'}{' '}
                        <span className="text-muted-foreground">
                          · {n} suggestion{n === 1 ? '' : 's'}
                        </span>
                      </span>
                      <Link
                        href={`/my/projects/${projectId}#suggestions`}
                        className={`${linkCls} shrink-0`}
                      >
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            <Collapsible
              title="Recent projects"
              count={graph.projects.length}
              meta={
                <Link href="/my/projects" className={linkCls}>
                  All projects
                </Link>
              }
              headingLevel={2}
              defaultOpen
              storageKey="overview:projects"
            >
              {recentProjects.length === 0 ? (
                <EmptyState
                  title="No projects yet"
                  description="Add one manually or import from GitHub."
                  action={
                    <Link href="/my/github" className={buttonVariants({ size: 'sm' })}>
                      Import from GitHub
                    </Link>
                  }
                />
              ) : (
                <ul className={listCls}>
                  {recentProjects.map((p) => (
                    <li key={p.id} className={`${rowCls} flex-wrap`}>
                      <Link
                        href={`/my/projects/${p.id}`}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="flex flex-wrap items-center gap-1">
                        {!p.userApproved ? <FlagBadge>Unapproved</FlagBadge> : null}
                        {(evidenceCountByProject.get(p.id) ?? 0) === 0 ? (
                          <FlagBadge>No evidence</FlagBadge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            <Collapsible
              title="Strongest skills"
              count={strengths.length}
              meta={
                <Link href="/my/skills" className={linkCls}>
                  All skills
                </Link>
              }
              headingLevel={2}
              defaultOpen
              storageKey="overview:skills"
            >
              {strengths.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No skill is linked to a project or experience yet, so none can be rated.
                </p>
              ) : (
                <ul className={listCls}>
                  {strengths.map(({ skill, strength }) => (
                    <li key={skill.id} className={rowCls}>
                      <span className="min-w-0 truncate font-medium">{skill.name}</span>
                      <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
                        {strength.supportingEntities.length}{' '}
                        {strength.supportingEntities.length === 1 ? 'source' : 'sources'}
                        <StrengthBadge level={strength.level} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            <Collapsible
              title="Recent achievements"
              count={graph.achievements.length}
              meta={
                <Link href="/my/achievements" className={linkCls}>
                  All achievements
                </Link>
              }
              headingLevel={2}
              storageKey="overview:achievements"
            >
              {recentAchievements.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No achievements recorded yet.
                </p>
              ) : (
                <ul className={listCls}>
                  {recentAchievements.map((a) => (
                    <li key={a.id} className={`${rowCls} flex-wrap`}>
                      <span className="min-w-0">
                        <Link
                          href={`/my/achievements#a-${a.id}`}
                          className="font-medium hover:underline"
                        >
                          {a.title}
                        </Link>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {formatDate(a.occurredOn)}
                        </span>
                      </span>
                      <VerificationBadge state={a.verificationState} />
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            <Collapsible
              title="Stories ready for interviews"
              count={graph.stories.filter((s) => s.userApproved).length}
              meta={
                <Link href="/my/stories" className={linkCls}>
                  All stories
                </Link>
              }
              headingLevel={2}
              storageKey="overview:stories"
            >
              {readyStories.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {graph.stories.length === 0
                    ? 'No stories yet.'
                    : `${graph.stories.length} ${graph.stories.length === 1 ? 'story is' : 'stories are'} drafted but none are approved.`}
                </p>
              ) : (
                <ul className={listCls}>
                  {readyStories.map((s) => (
                    <li key={s.id} className={rowCls}>
                      <Link
                        href={`/my/stories/${s.id}`}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>
          </div>

          <Collapsible
            title="GitHub"
            summary={
              connection ? `Connected as ${connection.githubLogin}` : 'Not connected'
            }
            meta={
              <Link href="/my/github" className={linkCls}>
                Manage
              </Link>
            }
            headingLevel={2}
            storageKey="overview:github"
          >
            {connection ? (
              <p className="text-sm">
                Connected as <span className="font-medium">{connection.githubLogin}</span>
                . {selectedRepoCount} of {repoCount}{' '}
                {repoCount === 1 ? 'repository' : 'repositories'} selected for import.
                Last sync:{' '}
                {lastRun?.finishedAt
                  ? `${formatDate(lastRun.finishedAt)} (${lastRun.status.toLowerCase()})`
                  : connection.lastSyncedAt
                    ? formatDate(connection.lastSyncedAt)
                    : 'never'}
                .
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                GitHub is not connected.{' '}
                <Link href="/my/github" className="text-primary hover:underline">
                  Connect it
                </Link>{' '}
                to import repositories as projects.
              </p>
            )}
          </Collapsible>
        </div>
      </CollapsibleGroup>

      {!nearlyEmpty && unknowns.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Not yet known: {unknowns.join('; ')}.
        </p>
      ) : null}
    </div>
  );
}
