import { safeHttpHref, type EvidenceGraphData, type MyosStory } from '@career-os/shared';
import { ActionForm } from '../../_components/action-form';
import { TonePill, VerificationBadge, VisibilityBadge } from '../../_components/badges';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
} from '../../_components/collapsible';
import { Mutation, PageHeader } from '../../_components/page-header';
import Link from 'next/link';
import { deleteStoryAction, setStoryApprovedAction } from '../actions';
import { competencyLabel, isFlaggedUnconfirmed, storyLinks } from '../helpers';
import { StoryForm } from '../story-form';
import { ReadyBadge, StarBody } from '../stories-view';

export interface StoryDetailViewProps {
  graph: EvidenceGraphData;
  story: MyosStory;
  readOnly?: boolean;
  backHref?: string;
}

export function StoryDetailView({
  graph,
  story,
  readOnly,
  backHref = '/my/stories',
}: StoryDetailViewProps) {
  const links = storyLinks(graph, story.id);
  const linkCount =
    links.projects.length + links.experiences.length + links.evidence.length;
  const written = [story.situation, story.task, story.action, story.result].filter(
    Boolean,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={{ href: backHref, label: 'Stories' }}
        title={story.title}
        actions={
          <Mutation readOnly={readOnly}>
            <ActionForm
              action={setStoryApprovedAction}
              submitLabel={
                story.userApproved ? 'Move back to draft' : 'Mark ready for interviews'
              }
              variant={story.userApproved ? 'outline' : 'default'}
            >
              <input type="hidden" name="id" value={story.id} />
              <input
                type="hidden"
                name="approved"
                value={story.userApproved ? '0' : '1'}
              />
            </ActionForm>
          </Mutation>
        }
      >
        <div className="flex flex-wrap items-center gap-1">
          <ReadyBadge ready={story.userApproved} />
          <VerificationBadge state={story.verificationState} />
          <VisibilityBadge visibility={story.visibility} />
          {story.competencies.map((c) => (
            <TonePill key={c} tone="neutral">
              {competencyLabel(c)}
            </TonePill>
          ))}
        </div>
        {isFlaggedUnconfirmed(story) ? (
          <p className="text-muted-foreground text-sm">
            This story was{' '}
            {story.verificationState === 'AI_GENERATED' ? 'AI-generated' : 'inferred'}.
            Review every line for accuracy before marking it ready.
          </p>
        ) : null}
      </PageHeader>

      <CollapsibleGroup>
        <div className="flex justify-end">
          <CollapsibleGroupControls label="story sections" />
        </div>
        <div className="mt-1 space-y-3">
          <Collapsible
            title="STAR story"
            summary={`${written} of 4 parts written`}
            headingLevel={2}
            defaultOpen
            storageKey="story:star"
          >
            <StarBody story={story} />
            {story.themes.length > 0 ? (
              <p className="text-muted-foreground mt-3 text-xs">
                Themes: {story.themes.join(', ')}
              </p>
            ) : null}
          </Collapsible>

          <Collapsible
            title="Linked projects, experience, and evidence"
            count={linkCount}
            headingLevel={2}
            defaultOpen
            storageKey="story:links"
          >
            {linkCount === 0 ? (
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
                {links.evidence.map((ev) => {
                  const href = safeHttpHref(ev.sourceUrl);
                  return (
                    <li key={ev.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Evidence: </span>
                      <VerificationBadge state={ev.verificationState} />
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {ev.title}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span>{ev.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Collapsible>

          <Collapsible title="Edit story" headingLevel={2} storageKey="story:edit">
            <Mutation readOnly={readOnly}>
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
            </Mutation>
          </Collapsible>

          <Collapsible title="Delete story" headingLevel={2}>
            <Mutation readOnly={readOnly}>
              <p className="text-sm">
                This permanently deletes the story. It cannot be undone.
              </p>
              <ActionForm
                action={deleteStoryAction}
                submitLabel="Delete story"
                pendingLabel="Deleting…"
                variant="destructive"
                confirmMessage={`Delete "${story.title}"? This cannot be undone.`}
              >
                <input type="hidden" name="id" value={story.id} />
              </ActionForm>
            </Mutation>
          </Collapsible>
        </div>
      </CollapsibleGroup>
    </div>
  );
}
