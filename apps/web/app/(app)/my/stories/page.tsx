import { loadOwnEvidenceGraph } from '@career-os/database';
import { COMPETENCIES, type MyosStory } from '@career-os/shared';
import { Badge, Label, Select, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { Feedback, firstParam } from '../projects/_components/feedback';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { EmptyState, VerificationBadge, VisibilityBadge } from '../_components/badges';
import { ActionForm } from '../skills/action-form';
import { deleteStoryAction, setStoryApprovedAction } from './actions';
import {
  STAR_PROMPTS,
  competencyCoverage,
  competencyLabel,
  filterStories,
  isFlaggedUnconfirmed,
  parseStoryFilter,
  storyLinks,
} from './helpers';
import { StoryForm } from './story-form';

export const metadata = { title: 'Stories · myOS' };

function storiesHref(competency: string | null, approvedOnly: boolean): string {
  const qs = new URLSearchParams();
  if (competency) qs.set('competency', competency);
  if (approvedOnly) qs.set('approved', '1');
  const s = qs.toString();
  return s ? `/my/stories?${s}` : '/my/stories';
}

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseStoryFilter(sp);
  const notice = firstParam(sp.notice);
  const user = await requireUser();
  const supabase = await createClient();
  const graph = await loadOwnEvidenceGraph(supabase, user.id);

  const stories = [...graph.stories].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = filterStories(stories, filter);
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

  return (
    <div className="space-y-6">
      <Feedback notice={notice} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stories</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your STAR story bank for behavioral interviews. Only stories you mark ready count toward
          coverage.
        </p>
      </div>

      <section aria-labelledby="coverage-heading" className="space-y-2">
        <h2 id="coverage-heading" className="text-sm font-medium">
          Competency coverage ({covered} of {COMPETENCIES.length} with a ready story)
        </h2>
        <ul className="flex flex-wrap gap-2">
          {coverage.map((c) => (
            <li key={c.competency}>
              <Link
                href={storiesHref(c.competency, filter.approvedOnly)}
                className={
                  (c.approvedCount > 0
                    ? 'border-border bg-accent'
                    : 'border-border border-dashed text-muted-foreground') +
                  ' focus-visible:ring-ring inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2'
                }
              >
                {competencyLabel(c.competency)}
                <span className="font-medium">
                  {c.approvedCount > 0 ? `${c.approvedCount} ready` : 'gap'}
                </span>
                {c.approvedCount === 0 && c.totalCount > 0 ? (
                  <span className="text-muted-foreground">({c.totalCount} draft)</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <details className="border-border rounded-md border" open={stories.length === 0}>
        <summary className="focus-visible:ring-ring cursor-pointer rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2">
          Write a new story
        </summary>
        <div className="border-border border-t px-3 py-3">
          <StoryForm
            projects={projectOptions}
            experiences={experienceOptions}
            evidence={evidenceOptions}
            idPrefix="new-story"
          />
        </div>
      </details>

      {stories.length === 0 ? (
        <EmptyState
          title="No stories yet"
          description="A good story answers four questions. Use these prompts with your own real experience."
          action={
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-left text-xs">
              {STAR_PROMPTS.map((p) => (
                <li key={p.label}>
                  <span className="text-foreground font-medium">{p.label}:</span> {p.prompt}
                </li>
              ))}
              <li>Examples to look for: a time you led without authority, disagreed with a teammate, handled a vague goal, or learned from a miss.</li>
            </ul>
          }
        />
      ) : (
        <section aria-labelledby="story-list-heading" className="space-y-3">
          <h2 id="story-list-heading" className="sr-only">
            Story list
          </h2>
          <form method="get" className="flex flex-wrap items-end gap-3" role="search">
            <div className="space-y-1">
              <Label htmlFor="story-competency">Competency</Label>
              <Select
                id="story-competency"
                name="competency"
                defaultValue={filter.competency ?? ''}
                className="w-56"
              >
                <option value="">All</option>
                {COMPETENCIES.map((c) => (
                  <option key={c} value={c}>
                    {competencyLabel(c)}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                name="approved"
                value="1"
                defaultChecked={filter.approvedOnly}
                className="focus-visible:ring-ring h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2"
              />
              Ready for interviews only
            </label>
            <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Apply
            </button>
            {filter.competency || filter.approvedOnly ? (
              <Link href="/my/stories" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Clear
              </Link>
            ) : null}
          </form>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            Showing {shown.length} of {stories.length} stor{stories.length === 1 ? 'y' : 'ies'}.
          </p>

          <ul className="space-y-3">
            {shown.map((story) => (
              <StoryCard key={story.id} story={story} links={storyLinks(graph, story.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StoryCard({
  story,
  links,
}: {
  story: MyosStory;
  links: ReturnType<typeof storyLinks>;
}) {
  const flagged = isFlaggedUnconfirmed(story);
  return (
    <li className="border-border rounded-md border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 font-medium">
          <Link href={`/my/stories/${story.id}`} className="underline-offset-2 hover:underline">
            {story.title}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-1">
          <VerificationBadge state={story.verificationState} />
          <VisibilityBadge visibility={story.visibility} />
          {story.userApproved ? (
            <Badge>Ready for interviews</Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          )}
        </div>
      </div>
      {flagged ? (
        <p className="text-muted-foreground mt-1 text-xs">
          This story was {story.verificationState === 'AI_GENERATED' ? 'AI-generated' : 'inferred'}.
          Review every line for accuracy before relying on it.
        </p>
      ) : null}
      {story.competencies.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Competencies">
          {story.competencies.map((c) => (
            <li key={c}>
              <Badge variant="secondary">{competencyLabel(c)}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {story.result ? (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">Result: {story.result}</p>
      ) : null}
      {links.projects.length + links.experiences.length + links.evidence.length > 0 ? (
        <p className="mt-2 text-xs">
          <span className="text-muted-foreground">References: </span>
          {links.projects.map((p) => (
            <Link key={p.id} href={`/my/projects/${p.id}`} className="mr-2 underline underline-offset-2">
              {p.name}
            </Link>
          ))}
          {links.experiences.map((e) => (
            <Link key={e.id} href="/profile" className="mr-2 underline underline-offset-2">
              {e.name}
            </Link>
          ))}
          {links.evidence.length > 0
            ? `${links.evidence.length} evidence item${links.evidence.length === 1 ? '' : 's'}`
            : ''}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-start gap-x-3">
        <ActionForm
          action={setStoryApprovedAction}
          submitLabel={story.userApproved ? 'Move back to draft' : 'Mark ready for interviews'}
          variant="outline"
        >
          <input type="hidden" name="id" value={story.id} />
          <input type="hidden" name="approved" value={story.userApproved ? '0' : '1'} />
        </ActionForm>
        <Link
          href={`/my/stories/${story.id}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' mt-2'}
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
    </li>
  );
}
