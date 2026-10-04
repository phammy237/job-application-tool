import { safeHttpHref } from '@career-os/shared';
import { Badge, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../../lib/myos/load-graph';
import { VerificationBadge, VisibilityBadge } from '../../_components/badges';
import { ActionForm } from '../../_components/action-form';
import { deleteStoryAction, setStoryApprovedAction } from '../actions';
import {
  STAR_PROMPTS,
  competencyLabel,
  isFlaggedUnconfirmed,
  storyLinks,
} from '../helpers';
import { StoryForm } from '../story-form';

export const metadata = { title: 'Story · myOS' };

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  const story = graph.stories.find((s) => s.id === id);
  if (!story) notFound();

  const links = storyLinks(graph, story.id);
  const sections = [story.situation, story.task, story.action, story.result];

  return (
    <div className="space-y-6">
      <Link
        href="/my/stories"
        className="text-muted-foreground text-sm underline underline-offset-2"
      >
        Back to stories
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{story.title}</h1>
        <div className="flex flex-wrap items-center gap-1">
          <VerificationBadge state={story.verificationState} />
          <VisibilityBadge visibility={story.visibility} />
          {story.userApproved ? (
            <Badge>Ready for interviews</Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          )}
        </div>
        {isFlaggedUnconfirmed(story) ? (
          <p className="text-muted-foreground text-sm">
            This story was{' '}
            {story.verificationState === 'AI_GENERATED' ? 'AI-generated' : 'inferred'}.
            Review every line for accuracy before marking it ready.
          </p>
        ) : null}
        {story.competencies.length > 0 ? (
          <ul className="flex flex-wrap gap-1" aria-label="Competencies">
            {story.competencies.map((c) => (
              <li key={c}>
                <Badge variant="secondary">{competencyLabel(c)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section aria-label="STAR text" className="space-y-3">
        {STAR_PROMPTS.map((p, i) => (
          <div key={p.label}>
            <h2 className="text-sm font-medium">{p.label}</h2>
            {sections[i] ? (
              <p className="mt-0.5 whitespace-pre-line text-sm">{sections[i]}</p>
            ) : (
              <p className="text-muted-foreground mt-0.5 text-sm">Not written yet.</p>
            )}
          </div>
        ))}
        {story.themes.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Themes: {story.themes.join(', ')}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="linked-heading" className="space-y-2">
        <h2 id="linked-heading" className="text-sm font-medium">
          Linked projects, experience, and evidence
        </h2>
        {links.projects.length + links.experiences.length + links.evidence.length ===
        0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing linked yet. Link what backs this story using the edit form below.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {links.projects.map((p) => (
              <li key={p.id}>
                <span className="text-muted-foreground">Project: </span>
                <Link
                  href={`/my/projects/${p.id}`}
                  className="underline underline-offset-2"
                >
                  {p.name}
                </Link>
              </li>
            ))}
            {links.experiences.map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">Experience: </span>
                <Link href="/profile" className="underline underline-offset-2">
                  {e.name}
                </Link>
              </li>
            ))}
            {links.evidence.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Evidence: </span>
                <VerificationBadge state={ev.verificationState} />
                {safeHttpHref(ev.sourceUrl) ? (
                  <a
                    href={safeHttpHref(ev.sourceUrl) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {ev.title}
                  </a>
                ) : (
                  <span>{ev.title}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-x-3">
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
        <ActionForm
          action={deleteStoryAction}
          submitLabel="Delete story"
          pendingLabel="Deleting…"
          variant="ghost"
          confirmMessage={`Delete "${story.title}"? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={story.id} />
        </ActionForm>
        <Link
          href="/my/stories"
          className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' mt-2'}
        >
          Back to list
        </Link>
      </div>

      <section aria-labelledby="edit-heading" className="space-y-2">
        <h2 id="edit-heading" className="text-sm font-medium">
          Edit story
        </h2>
        <StoryForm
          key={story.updatedAt}
          story={story}
          projects={graph.projects.map((p) => ({ id: p.id, label: p.name }))}
          experiences={graph.experiences.map((e) => ({
            id: e.id,
            label: `${e.title} at ${e.company}`,
          }))}
          evidence={graph.evidence.map((e) => ({
            id: e.id,
            label: `${e.title} (${e.sourceType})`,
          }))}
          selectedProjectIds={links.projects.map((p) => p.id)}
          selectedExperienceIds={links.experiences.map((e) => e.id)}
          selectedEvidenceIds={links.evidence.map((e) => e.id)}
          idPrefix="edit-story"
        />
      </section>
    </div>
  );
}
