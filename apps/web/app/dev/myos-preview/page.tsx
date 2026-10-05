import {
  DEFAULT_MAX_NODES,
  buildEvidenceGraph,
  buildSupportIndex,
} from '@career-os/shared';
import { notFound } from 'next/navigation';
import { MyosEvidenceMatch } from '../../(app)/applications/[id]/myos-evidence-match';
import { MyosInterviewPrep } from '../../(app)/applications/[id]/myos-interview-prep';
import { PageHeader } from '../../(app)/my/_components/page-header';
import { MYOS_CONTENT_ID, SkipToContent } from '../../(app)/my/_components/skip-link';
import { paramValue } from '../../(app)/my/_components/filter-state';
import { AchievementsView } from '../../(app)/my/achievements/achievements-view';
import { GraphView } from '../../(app)/my/graph/graph-view';
import { SubnavBar } from '../../(app)/my/my-subnav';
import { OverviewView } from '../../(app)/my/overview-view';
import { ProjectDetailView } from '../../(app)/my/projects/[id]/project-detail-view';
import { projectDetailView } from '../../(app)/my/projects/detail-helpers';
import { ProjectsListView } from '../../(app)/my/projects/projects-list-view';
import { SkillsView } from '../../(app)/my/skills/skills-view';
import { StoryDetailView } from '../../(app)/my/stories/[id]/story-detail-view';
import { StoriesView } from '../../(app)/my/stories/stories-view';
import { TimelineView } from '../../(app)/my/timeline/timeline-view';
import { PreviewAsk } from './preview-ask';
import {
  SAMPLE_CONNECTION,
  SAMPLE_GRAPH,
  SAMPLE_JOB,
  SAMPLE_LAST_RUN,
  SAMPLE_PENDING,
  SAMPLE_PROJECT_ID,
  SAMPLE_REPOS,
  SAMPLE_STORY_ID,
} from './sample-graph';

export const metadata = { title: 'myOS preview (sample data)' };
// Never prerender: the NODE_ENV gate must be evaluated per request.
export const dynamic = 'force-dynamic';

const TABS = [
  ['overview', 'Overview'],
  ['projects', 'Projects'],
  ['project', 'Project detail'],
  ['skills', 'Skills'],
  ['timeline', 'Timeline'],
  ['achievements', 'Achievements'],
  ['stories', 'Stories'],
  ['story', 'Story detail'],
  ['graph', 'Graph'],
  ['ask', 'Ask'],
  ['job', 'Job match'],
] as const;
type Tab = (typeof TABS)[number][0];

const BASE = '/dev/myos-preview';
const tabHref = (tab: Tab, extra = '') => `${BASE}?tab=${tab}${extra}`;

/**
 * DEV-ONLY preview of the real myOS views over FICTIONAL sample data, for inspecting the UI when
 * Supabase is unavailable. Returns 404 outside `next dev`. Reads no database and no user data, so
 * it is safe outside the authenticated (app) group (CLAUDE.md public/private boundary). Every view
 * renders with `readOnly`, which disables all mutation forms, so no server action can be sent.
 */
export default async function MyosPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();

  const sp = await searchParams;
  const rawTab = paramValue(sp.tab, 20);
  const tab: Tab = (TABS.find(([t]) => t === rawTab)?.[0] ?? 'overview') as Tab;
  const graph = SAMPLE_GRAPH;
  const p = (key: string, max = 100) => paramValue(sp[key], max);

  let content: React.ReactNode;
  switch (tab) {
    case 'overview':
      content = (
        <OverviewView
          graph={graph}
          pending={SAMPLE_PENDING}
          connection={SAMPLE_CONNECTION}
          repoCount={SAMPLE_REPOS.length}
          selectedRepoCount={SAMPLE_REPOS.filter((r) => r.selected).length}
          lastRun={SAMPLE_LAST_RUN}
        />
      );
      break;
    case 'projects':
      content = (
        <ProjectsListView
          graph={graph}
          readOnly
          initial={{
            q: p('q'),
            status: p('status', 20),
            origin: p('origin', 20),
            sort: p('sort', 20),
          }}
        />
      );
      break;
    case 'project': {
      const id = p('id', 40) || SAMPLE_PROJECT_ID;
      const view = projectDetailView(graph, id);
      if (!view) notFound();
      content = (
        <ProjectDetailView
          graph={graph}
          view={view}
          pending={SAMPLE_PENDING.filter((c) => c.projectId === id)}
          repo={SAMPLE_REPOS.find((r) => r.projectId === id) ?? null}
          readOnly
        />
      );
      break;
    }
    case 'skills':
      content = (
        <SkillsView
          graph={graph}
          readOnly
          initial={{
            q: p('q'),
            category: p('category', 40),
            strength: p('strength', 20),
            sort: p('sort', 20),
          }}
        />
      );
      break;
    case 'timeline':
      content = (
        <TimelineView
          graph={graph}
          initial={{
            q: p('q'),
            type: p('type', 20),
            year: p('year', 4),
            skill: p('skill', 40),
          }}
        />
      );
      break;
    case 'achievements':
      content = (
        <AchievementsView
          graph={graph}
          readOnly
          initial={{ q: p('q'), kind: p('kind', 20), verified: p('verified', 1) }}
        />
      );
      break;
    case 'stories':
      content = (
        <StoriesView
          graph={graph}
          readOnly
          initial={{
            q: p('q'),
            competency: p('competency', 60),
            approved: p('approved', 1),
          }}
          coverageHref={(c) => tabHref('stories', `&competency=${c}`)}
          storyHref={(id) => tabHref('story', `&id=${id}`)}
        />
      );
      break;
    case 'story': {
      const id = p('id', 40) || SAMPLE_STORY_ID;
      const story = graph.stories.find((s) => s.id === id);
      if (!story) notFound();
      content = (
        <StoryDetailView
          graph={graph}
          story={story}
          readOnly
          backHref={tabHref('stories')}
        />
      );
      break;
    }
    case 'graph':
      content = (
        <div className="space-y-6">
          <PageHeader
            title="Evidence graph"
            description="How your projects, skills, experience, achievements, stories and evidence connect."
          />
          <GraphView viz={buildEvidenceGraph(graph, { maxNodes: DEFAULT_MAX_NODES })} />
        </div>
      );
      break;
    case 'ask':
      content = (
        <div className="space-y-6">
          <PageHeader
            title="Ask my evidence"
            description="Ask in plain language what you have done and what proves it."
          />
          <PreviewAsk />
        </div>
      );
      break;
    case 'job': {
      const supportIndex = buildSupportIndex(graph);
      content = (
        <div className="space-y-8">
          <PageHeader
            title={`${SAMPLE_JOB.title} at ${SAMPLE_JOB.company}`}
            description="The two myOS panels shown on an application page (sample job)."
          />
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
        </div>
      );
      break;
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <SkipToContent />
      <div className="mx-auto max-w-5xl space-y-6 px-4 pb-10 pt-4 sm:px-6">
        <header>
          <p
            role="note"
            className="border-border bg-accent text-accent-foreground rounded-md border px-4 py-2 text-xs"
          >
            <strong>Dev preview — sample data.</strong> Everything here is fictional and
            computed locally; nothing is read from or saved to Supabase, and editing is
            disabled. Links into /my need a real login.
          </p>
        </header>
        <SubnavBar
          label="Preview sections"
          items={TABS.map(([t, label]) => ({
            href: tabHref(t),
            label,
            active: t === tab,
          }))}
        />
        <main id={MYOS_CONTENT_ID} tabIndex={-1} className="min-w-0 focus:outline-none">
          {content}
        </main>
      </div>
    </div>
  );
}
