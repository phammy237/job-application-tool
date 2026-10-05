import { COMPETENCIES, type EvidenceGraphData, type MyosStory } from '@career-os/shared';
import { buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { ActionForm } from '../_components/action-form';
import {
  EmptyState,
  TonePill,
  VerificationBadge,
  VisibilityBadge,
} from '../_components/badges';
import { Collapsible } from '../_components/collapsible';
import { Feedback } from '../_components/feedback';
import { FilterableList, type FilterItem } from '../_components/filterable-list';
import type { FilterState } from '../_components/filter-state';
import { Mutation, PageHeader } from '../_components/page-header';
import { deleteStoryAction, setStoryApprovedAction } from './actions';
import {
  STAR_PROMPTS,
  competencyCoverage,
  competencyLabel,
  isFlaggedUnconfirmed,
  storyLinks,
} from './helpers';
import { StoryForm } from './story-form';

export function ReadyBadge({ ready }: { ready: boolean }) {
  return ready ? (
    <TonePill tone="success" dot>
      Ready for interviews
    </TonePill>
  ) : (
    <TonePill tone="neutral">Draft</TonePill>
  );
}

/** The four STAR parts of a story, with an explicit "Not written yet" for empty parts. */
export function StarBody({ story }: { story: MyosStory }) {
  const parts = [story.situation, story.task, story.action, story.result];
  return (
    <dl className="space-y-3">
      {STAR_PROMPTS.map((p, i) => (
        <div key={p.label} className="grid gap-0.5 sm:grid-cols-[6rem_1fr] sm:gap-3">
          <dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wide sm:pt-0.5">
            {p.label}
          </dt>
          <dd className="text-sm">
            {parts[i] ? (
              <span className="whitespace-pre-line">{parts[i]}</span>
            ) : (
              <span className="text-muted-foreground italic">Not written yet.</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StoryCard({
  story,
  links,
  readOnly,
  detailHref,
}: {
  story: MyosStory;
  links: ReturnType<typeof storyLinks>;
  readOnly?: boolean;
  detailHref: string;
}) {
  const flagged = isFlaggedUnconfirmed(story);
  const refCount =
    links.projects.length + links.experiences.length + links.evidence.length;
  return (
    <Collapsible
      variant="row"
      headingLevel={3}
      title={story.title}
      meta={
        <>
          <ReadyBadge ready={story.userApproved} />
          <Link
            href={detailHref}
            className="text-primary focus-visible:ring-ring inline-flex min-h-10 items-center rounded-md px-1.5 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2"
          >
            Open<span className="sr-only"> {story.title}</span>
          </Link>
        </>
      }
      summary={
        story.competencies.length > 0
          ? story.competencies.map(competencyLabel).join(' · ')
          : 'No competencies tagged'
      }
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-1">
        <VerificationBadge state={story.verificationState} />
        <VisibilityBadge visibility={story.visibility} />
      </div>
      {flagged ? (
        <p className="text-muted-foreground text-xs">
          This story was{' '}
          {story.verificationState === 'AI_GENERATED' ? 'AI-generated' : 'inferred'}.
          Review every line for accuracy before relying on it.
        </p>
      ) : null}
      <StarBody story={story} />
      {refCount > 0 ? (
        <p className="text-xs">
          <span className="text-muted-foreground">References: </span>
          {links.projects.map((p) => (
            <Link
              key={p.id}
              href={`/my/projects/${p.id}`}
              className="mr-2 underline underline-offset-2"
            >
              {p.name}
            </Link>
          ))}
          {links.experiences.map((e) => (
            <Link
              key={e.id}
              href="/profile"
              className="mr-2 underline underline-offset-2"
            >
              {e.name}
            </Link>
          ))}
          {links.evidence.length > 0
            ? `${links.evidence.length} evidence item${links.evidence.length === 1 ? '' : 's'}`
            : ''}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Nothing linked to back this story yet.
        </p>
      )}
      <Mutation readOnly={readOnly}>
        <div className="border-border flex flex-wrap items-start gap-x-2 border-t pt-1">
          <ActionForm
            action={setStoryApprovedAction}
            submitLabel={
              story.userApproved ? 'Move back to draft' : 'Mark ready for interviews'
            }
            variant="outline"
          >
            <input type="hidden" name="id" value={story.id} />
            <input type="hidden" name="approved" value={story.userApproved ? '0' : '1'} />
          </ActionForm>
          <Link
            href={detailHref}
            className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} mt-2`}
          >
            View and edit
          </Link>
          <ActionForm
            action={deleteStoryAction}
            submitLabel="Delete"
            pendingLabel="Deleting…"
            variant="ghost"
            confirmMessage={`Delete "${story.title}"? This cannot be undone.`}
          >
            <input type="hidden" name="id" value={story.id} />
          </ActionForm>
        </div>
      </Mutation>
    </Collapsible>
  );
}

export interface StoriesViewProps {
  graph: EvidenceGraphData;
  initial: FilterState;
  notice?: string;
  readOnly?: boolean;
  /** Prefix for competency coverage links (the dev preview keeps its own tab param). */
  coverageHref?: (competency: string) => string;
  storyHref?: (id: string) => string;
}

export function StoriesView({
  graph,
  initial,
  notice,
  readOnly,
  coverageHref = (c) => `/my/stories?competency=${c}`,
  storyHref = (id) => `/my/stories/${id}`,
}: StoriesViewProps) {
  const stories = [...graph.stories].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const coverage = competencyCoverage(stories);
  const covered = coverage.filter((c) => c.approvedCount > 0).length;

  const projectOptions = graph.projects.map((p) => ({ id: p.id, label: p.name }));
  const experienceOptions = graph.experiences.map((e) => ({
    id: e.id,
    label: `${e.title} at ${e.company}`,
  }));
  const evidenceOptions = graph.evidence.map((e) => ({
    id: e.id,
    label: `${e.title} (${e.sourceType})`,
  }));

  const items: FilterItem[] = stories.map((story) => ({
    id: story.id,
    text: [
      story.title,
      story.situation,
      story.task,
      story.action,
      story.result,
      ...story.themes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    facets: {
      competency: story.competencies,
      approved: story.userApproved ? '1' : '',
    },
    node: (
      <StoryCard
        story={story}
        links={storyLinks(graph, story.id)}
        readOnly={readOnly}
        detailHref={storyHref(story.id)}
      />
    ),
  }));

  return (
    <div className="space-y-6">
      <Feedback notice={notice} />
      <PageHeader
        title="Stories"
        description="Your STAR story bank for behavioral interviews. Only stories you mark ready count toward coverage."
        actions={
          <a href="#new-story" className={buttonVariants({ size: 'sm' })}>
            Write a story
          </a>
        }
      />

      <Collapsible
        title="Competency coverage"
        summary={`${covered} of ${COMPETENCIES.length} competencies have a ready story`}
        count={COMPETENCIES.length - covered}
        headingLevel={2}
        defaultOpen
        storageKey="stories:coverage"
      >
        <p className="text-muted-foreground mb-2 text-xs">
          Gaps are competencies with no ready story. Select one to filter the list.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {coverage.map((c) => (
            <li key={c.competency}>
              <Link
                href={coverageHref(c.competency)}
                className={`focus-visible:ring-ring inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 ${
                  c.approvedCount > 0
                    ? 'border-border bg-accent text-accent-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent border-dashed'
                }`}
              >
                <span aria-hidden="true">{c.approvedCount > 0 ? '✓' : '○'}</span>
                {competencyLabel(c.competency)}
                <span className="font-medium">
                  {c.approvedCount > 0 ? `${c.approvedCount} ready` : 'gap'}
                </span>
                {c.approvedCount === 0 && c.totalCount > 0 ? (
                  <span>({c.totalCount} draft)</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </Collapsible>

      {stories.length === 0 ? (
        <EmptyState
          title="No stories yet"
          description={
            <ul className="list-disc space-y-1 pl-5 text-left text-xs">
              {STAR_PROMPTS.map((p) => (
                <li key={p.label}>
                  <span className="text-foreground font-medium">{p.label}:</span>{' '}
                  {p.prompt}
                </li>
              ))}
              <li>
                Examples to look for: a time you led without authority, disagreed with a
                teammate, handled a vague goal, or learned from a miss.
              </li>
            </ul>
          }
          action={
            <a href="#new-story" className={buttonVariants({ size: 'sm' })}>
              Write your first story
            </a>
          }
        />
      ) : (
        <section aria-labelledby="story-list-heading" className="space-y-3">
          <h2 id="story-list-heading" className="sr-only">
            Story list
          </h2>
          <FilterableList
            label="Filter stories"
            items={items}
            initial={initial}
            search={{ label: 'Search', placeholder: 'Title or STAR text' }}
            facets={[
              {
                param: 'competency',
                label: 'Competency',
                options: COMPETENCIES.map((c) => ({
                  value: c,
                  label: competencyLabel(c),
                })),
              },
            ]}
            toggles={[{ param: 'approved', label: 'Ready for interviews only' }]}
            noun={{ singular: 'story', plural: 'stories' }}
            expandControls
          />
        </section>
      )}

      <Collapsible
        id="new-story"
        title="Write a new story"
        headingLevel={2}
        defaultOpen={stories.length === 0}
      >
        <Mutation readOnly={readOnly}>
          <StoryForm
            projects={projectOptions}
            experiences={experienceOptions}
            evidence={evidenceOptions}
            idPrefix="new-story"
          />
        </Mutation>
      </Collapsible>
    </div>
  );
}
