import {
  getOwnGithubConnection,
  listOwnCandidates,
  listOwnGithubRepositories,
  listOwnGithubSyncRuns,
  loadOwnEvidenceGraph,
} from '@career-os/database';
import {
  computeAllSkillStrengths,
  evidenceCoverage,
  type CoverageGap,
  type EvidenceGraphData,
} from '@career-os/shared';
import { buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import {
  buildChecklist,
  buildSnapshot,
  buildUnknowns,
  formatDate,
  isNearlyEmpty,
} from '../../../lib/myos/home';
import { createClient } from '../../../lib/supabase/server';
import { EmptyState, FlagBadge, StrengthBadge, VerificationBadge } from './_components/badges';

function sortByRecent<T>(items: T[], date: (item: T) => string | null): T[] {
  return [...items].sort((a, b) => (date(b) ?? '').localeCompare(date(a) ?? ''));
}

function gapHref(gap: CoverageGap, graph: EvidenceGraphData): string {
  if (gap.type === 'PROJECT') return `/my/projects/${gap.id}`;
  if (gap.type === 'ACHIEVEMENT') {
    const projectId = graph.achievements.find((a) => a.id === gap.id)?.projectId;
    return projectId ? `/my/projects/${projectId}` : '/my/projects';
  }
  return '/my/stories';
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkCls = 'text-primary text-xs hover:underline focus-visible:underline';

export default async function MyOverviewPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();

  const [graph, pending, connection, repos, runs] = await Promise.all([
    loadOwnEvidenceGraph(supabase, user.id),
    listOwnCandidates(supabase, user.id, 'PENDING'),
    getOwnGithubConnection(supabase, user.id),
    listOwnGithubRepositories(supabase, user.id),
    listOwnGithubSyncRuns(supabase, user.id, 1),
  ]);

  const snapshot = buildSnapshot(graph);
  const coverage = evidenceCoverage(graph);
  const checklist = buildChecklist(graph, connection, pending);
  const unknowns = buildUnknowns(graph, connection);
  const nearlyEmpty = isNearlyEmpty(snapshot);

  const strengths = computeAllSkillStrengths(graph, now)
    .filter((s) => s.strength.level !== 'NONE')
    .slice(0, 6);
  const recentProjects = sortByRecent(graph.projects, (p) => p.startDate).slice(0, 5);
  const recentAchievements = sortByRecent(graph.achievements, (a) => a.occurredOn ?? a.createdAt).slice(0, 5);
  const readyStories = graph.stories.filter((s) => s.userApproved).slice(0, 5);
  const evidenceCountByProject = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.fromType === 'EVIDENCE' && e.toType === 'PROJECT') {
      evidenceCountByProject.set(e.toId, (evidenceCountByProject.get(e.toId) ?? 0) + 1);
    }
  }

  const pendingByProject = new Map<string, number>();
  for (const c of pending) {
    if (c.projectId) pendingByProject.set(c.projectId, (pendingByProject.get(c.projectId) ?? 0) + 1);
  }
  const projectName = new Map(graph.projects.map((p) => [p.id, p.name]));
  const selectedRepos = repos.filter((r) => r.selected).length;
  const lastRun = runs[0] ?? null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">What does Career OS know about me?</h1>
        <p className="mt-2 text-sm" data-testid="myos-snapshot">
          {snapshot.sentence}
        </p>
      </header>

      {nearlyEmpty ? (
        <Section title="Get started">
          <ol className="space-y-2">
            {checklist.map((item) => (
              <li key={item.step} className="flex items-start gap-3 text-sm">
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
                  <Link href={item.href} className="font-medium hover:underline">
                    {item.step}. {item.label}
                  </Link>
                  <span className="sr-only">{item.done ? ' (done)' : ' (not done)'}</span>
                  <p className="text-muted-foreground text-xs">{item.hint}</p>
                </div>
              </li>
            ))}
          </ol>
          {unknowns.length > 0 ? (
            <p className="border-border text-muted-foreground border-t pt-3 text-sm">
              What Career OS does <span className="text-foreground font-medium">not</span> know right
              now: {unknowns.join('; ')}. It will not guess, and it never invents facts to fill these
              gaps.
            </p>
          ) : null}
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Evidence coverage"
          action={
            <Link href="/my/projects" className={linkCls}>
              Projects
            </Link>
          }
        >
          {coverage.total === 0 ? (
            <p className="text-muted-foreground text-sm">
              No projects, achievements, or stories to cover yet.
            </p>
          ) : (
            <>
              <p className="text-sm">
                {coverage.covered} of {coverage.total} projects, achievements, and stories have at
                least one linked evidence item
                <span className="text-muted-foreground">
                  {' '}
                  (projects {coverage.byType.PROJECT.covered}/{coverage.byType.PROJECT.total},
                  achievements {coverage.byType.ACHIEVEMENT.covered}/
                  {coverage.byType.ACHIEVEMENT.total}, stories {coverage.byType.STORY.covered}/
                  {coverage.byType.STORY.total})
                </span>
                .
              </p>
              {coverage.gaps.length > 0 ? (
                <ul className="divide-border divide-y text-sm">
                  {coverage.gaps.slice(0, 6).map((gap) => (
                    <li key={`${gap.type}-${gap.id}`} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">{gap.message}</span>
                      <Link href={gapHref(gap, graph)} className={`${linkCls} shrink-0`}>
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
              ) : null}
            </>
          )}
        </Section>

        <Section
          title="Suggestions waiting for you"
          action={
            <Link href="/my/projects" className={linkCls}>
              Review
            </Link>
          }
        >
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending suggestions.</p>
          ) : (
            <>
              <p className="text-sm">
                {pending.length} inferred {pending.length === 1 ? 'suggestion is' : 'suggestions are'}{' '}
                not yet part of your profile.
              </p>
              <ul className="divide-border divide-y text-sm">
                {[...pendingByProject.entries()].slice(0, 5).map(([projectId, n]) => (
                  <li key={projectId} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      {projectName.get(projectId) ?? 'Project'}: {n}
                    </span>
                    <Link href={`/my/projects/${projectId}#suggestions`} className={`${linkCls} shrink-0`}>
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section
          title="Recent projects"
          action={
            <Link href="/my/projects" className={linkCls}>
              All projects
            </Link>
          }
        >
          {recentProjects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Add one manually or import from GitHub."
            />
          ) : (
            <ul className="divide-border divide-y text-sm">
              {recentProjects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <Link href={`/my/projects/${p.id}`} className="font-medium hover:underline">
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
        </Section>

        <Section title="Strongest skills">
          {strengths.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No skill is linked to a project or experience yet, so none can be rated.
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {strengths.map(({ skill, strength }) => (
                <li key={skill.id} className="flex items-center justify-between gap-2 py-1.5">
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
        </Section>

        <Section title="Recent achievements">
          {recentAchievements.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No achievements recorded. Add them from a project page.
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {recentAchievements.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    {a.projectId ? (
                      <Link href={`/my/projects/${a.projectId}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{a.title}</span>
                    )}
                    <span className="text-muted-foreground ml-2 text-xs">{formatDate(a.occurredOn)}</span>
                  </span>
                  <VerificationBadge state={a.verificationState} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Stories ready for interviews"
          action={
            <Link href="/my/stories" className={linkCls}>
              All stories
            </Link>
          }
        >
          {readyStories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {graph.stories.length === 0
                ? 'No stories yet.'
                : `${graph.stories.length} ${graph.stories.length === 1 ? 'story is' : 'stories are'} drafted but none are approved.`}
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {readyStories.map((s) => (
                <li key={s.id} className="py-1.5 font-medium">
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="GitHub"
          action={
            <Link href="/my/github" className={linkCls}>
              Manage
            </Link>
          }
        >
          {connection ? (
            <p className="text-sm">
              Connected as <span className="font-medium">{connection.githubLogin}</span>.{' '}
              {selectedRepos} of {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}{' '}
              selected for import. Last sync:{' '}
              {lastRun?.finishedAt
                ? `${formatDate(lastRun.finishedAt)} (${lastRun.status.toLowerCase()})`
                : (connection.lastSyncedAt ? formatDate(connection.lastSyncedAt) : 'never')}
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
        </Section>
      </div>

      {!nearlyEmpty && unknowns.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Not yet known: {unknowns.join('; ')}.
        </p>
      ) : null}

      {!nearlyEmpty ? (
        <p>
          <Link href="/my/projects" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Review projects
          </Link>
        </p>
      ) : null}
    </div>
  );
}
