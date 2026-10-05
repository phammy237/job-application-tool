import type { EvidenceGraphData } from '@career-os/shared';
import { Input, Label, Select, Textarea, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { formatDate } from '../../../../lib/myos/home';
import { ActionForm } from '../_components/action-form';
import {
  EmptyState,
  FlagBadge,
  TonePill,
  VerificationBadge,
  VisibilityBadge,
} from '../_components/badges';
import { Collapsible } from '../_components/collapsible';
import { FilterableList, type FilterItem } from '../_components/filterable-list';
import type { FilterState } from '../_components/filter-state';
import { Mutation, PageHeader } from '../_components/page-header';
import { AchievementSupport } from './achievement-support';
import { createAchievementAction, deleteAchievementAction } from './actions';

const KINDS = [
  ['ACHIEVEMENT', 'Achievement'],
  ['AWARD', 'Award'],
  ['METRIC', 'Metric'],
  ['LAUNCH', 'Launch'],
  ['LEADERSHIP', 'Leadership'],
  ['MILESTONE', 'Milestone'],
] as const;
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS);

export interface AchievementsViewProps {
  graph: EvidenceGraphData;
  initial: FilterState;
  readOnly?: boolean;
}

export function AchievementsView({ graph, initial, readOnly }: AchievementsViewProps) {
  const projectName = new Map(graph.projects.map((p) => [p.id, p.name]));
  const experienceName = new Map(
    graph.experiences.map((e) => [e.id, `${e.title} at ${e.company}`]),
  );
  const evidenceCount = new Map<string, number>();
  const linkedEvidence = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.relation === 'SUPPORTS' && edge.toType === 'ACHIEVEMENT') {
      evidenceCount.set(edge.toId, (evidenceCount.get(edge.toId) ?? 0) + 1);
      if (edge.fromType === 'EVIDENCE') {
        const set = linkedEvidence.get(edge.toId) ?? new Set<string>();
        set.add(edge.fromId);
        linkedEvidence.set(edge.toId, set);
      }
    }
  }
  const evidenceOptionsFor = (achievementId: string) =>
    graph.evidence
      .filter((e) => !linkedEvidence.get(achievementId)?.has(e.id))
      .map((e) => ({ id: e.id, label: `${e.title} (${e.sourceType})` }));
  const achievements = [...graph.achievements].sort(
    (a, b) =>
      (b.occurredOn ?? '').localeCompare(a.occurredOn ?? '') ||
      a.title.localeCompare(b.title),
  );
  const kindsPresent = KINDS.filter(([k]) => achievements.some((a) => a.kind === k));

  const items: FilterItem[] = achievements.map((a) => {
    const owner =
      (a.projectId && projectName.get(a.projectId)) ||
      (a.experienceId && experienceName.get(a.experienceId)) ||
      null;
    const count = evidenceCount.get(a.id) ?? 0;
    return {
      id: a.id,
      text: `${a.title} ${a.metricText ?? ''} ${owner ?? ''}`.toLowerCase(),
      facets: {
        kind: a.kind,
        verified: a.verificationState === 'VERIFIED' ? '1' : '',
      },
      node: (
        <article
          id={`a-${a.id}`}
          aria-labelledby={`a-${a.id}-t`}
          className="border-border bg-card target:ring-ring scroll-mt-24 space-y-2 rounded-lg border p-4 text-sm target:ring-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 basis-60">
              <h3 id={`a-${a.id}-t`} className="font-medium">
                {a.title}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {KIND_LABEL[a.kind] ?? a.kind} ·{' '}
                {a.occurredOn ? formatDate(a.occurredOn) : 'Undated'}
                {owner ? ` · ${owner}` : ''}
              </p>
              {a.metricText ? (
                <p className="mt-1 text-xs">
                  <span className="text-muted-foreground">Metric: </span>
                  {a.metricText}
                </p>
              ) : null}
              {a.description ? (
                <p className="text-muted-foreground mt-1 whitespace-pre-line text-xs">
                  {a.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <VerificationBadge state={a.verificationState} />
              <VisibilityBadge visibility={a.visibility} />
              {a.userApproved ? null : <FlagBadge>Not approved</FlagBadge>}
              {count === 0 ? <FlagBadge>No evidence</FlagBadge> : null}
            </div>
          </div>
          <AchievementSupport
            achievementId={a.id}
            evidenceCount={count}
            verified={a.verificationState === 'VERIFIED'}
            options={evidenceOptionsFor(a.id)}
            readOnly={readOnly}
          />
          <Mutation readOnly={readOnly}>
            <ActionForm
              action={deleteAchievementAction}
              submitLabel="Delete"
              pendingLabel="Deleting…"
              variant="ghost"
              confirmMessage={`Delete "${a.title}"? This cannot be undone.`}
            >
              <input type="hidden" name="id" value={a.id} />
            </ActionForm>
          </Mutation>
        </article>
      ),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Achievements"
        description={
          <>
            Awards, launches, leadership moments, and metrics. They appear on your{' '}
            <Link
              href="/my/timeline"
              className="text-primary underline underline-offset-2"
            >
              timeline
            </Link>
            .
          </>
        }
        actions={
          <a href="#add-achievement" className={buttonVariants({ size: 'sm' })}>
            Add an achievement
          </a>
        }
      />

      {achievements.length === 0 ? (
        <EmptyState
          title="No achievements yet"
          description="Record an award, launch, or measurable result, with only claims you can back up."
          action={
            <a href="#add-achievement" className={buttonVariants({ size: 'sm' })}>
              Add your first achievement
            </a>
          }
        />
      ) : (
        <section aria-labelledby="ach-list-heading" className="space-y-3">
          <h2 id="ach-list-heading" className="sr-only">
            Your achievements
          </h2>
          <FilterableList
            label="Filter achievements"
            items={items}
            initial={initial}
            search={{ label: 'Search', placeholder: 'Title, metric, or project' }}
            facets={
              kindsPresent.length > 1
                ? [
                    {
                      param: 'kind',
                      label: 'Kind',
                      kind: 'chips',
                      options: kindsPresent.map(([value, label]) => ({ value, label })),
                    },
                  ]
                : []
            }
            toggles={[{ param: 'verified', label: 'Verified only' }]}
            noun={{ singular: 'achievement', plural: 'achievements' }}
            expandControls
            listClassName="space-y-3"
          />
        </section>
      )}

      <Collapsible
        id="add-achievement"
        title="Add an achievement"
        headingLevel={2}
        defaultOpen={achievements.length === 0}
      >
        <Mutation readOnly={readOnly}>
          <ActionForm
            action={createAchievementAction}
            submitLabel="Add achievement"
            resetOnSuccess
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ach-title">Title</Label>
                <Input id="ach-title" name="title" required maxLength={300} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ach-kind">Kind</Label>
                <Select id="ach-kind" name="kind" defaultValue="ACHIEVEMENT">
                  {KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ach-date">Date (optional)</Label>
                <Input id="ach-date" name="occurredOn" type="date" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ach-metric">Metric (optional)</Label>
                <Input
                  id="ach-metric"
                  name="metricText"
                  maxLength={300}
                  aria-describedby="ach-metric-help"
                />
                <p id="ach-metric-help" className="text-muted-foreground text-xs">
                  State only metrics you can evidence. A metric is never marked verified
                  until a supporting evidence item is linked.
                </p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ach-desc">Description (optional)</Label>
                <Textarea id="ach-desc" name="description" rows={3} maxLength={4000} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ach-project">Project (optional)</Label>
                <Select id="ach-project" name="projectId" defaultValue="">
                  <option value="">None</option>
                  {graph.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ach-exp">Experience (optional)</Label>
                <Select id="ach-exp" name="experienceId" defaultValue="">
                  <option value="">None</option>
                  {graph.experiences.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} at {e.company}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ach-vis">Visibility</Label>
                <Select id="ach-vis" name="visibility" defaultValue="PRIVATE">
                  <option value="PRIVATE">Private</option>
                  <option value="CAREER_OS_ONLY">Career OS only</option>
                  <option value="PUBLIC">Public</option>
                </Select>
              </div>
              <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                <input
                  id="ach-approved"
                  name="userApproved"
                  type="checkbox"
                  className="accent-primary h-4 w-4"
                />
                I confirm this is accurate
              </label>
            </div>
          </ActionForm>
        </Mutation>
      </Collapsible>
      {achievements.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          <TonePill tone="success">Verified</TonePill> means you linked supporting
          evidence and confirmed it backs the claim; nothing is checked externally.
        </p>
      ) : null}
    </div>
  );
}
