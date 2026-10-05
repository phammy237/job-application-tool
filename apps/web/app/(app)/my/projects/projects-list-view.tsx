import type { EvidenceGraphData } from '@career-os/shared';
import { Input, Label, Select, Textarea, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { EmptyState, FlagBadge, TonePill, VisibilityBadge } from '../_components/badges';
import { Collapsible } from '../_components/collapsible';
import { Feedback } from '../_components/feedback';
import { FilterableList, type FilterItem } from '../_components/filterable-list';
import type { FilterState } from '../_components/filter-state';
import { Mutation, PageHeader } from '../_components/page-header';
import { SubmitButton } from './_components/submit-button';
import { createProjectAction } from './actions';
import { summarizeProjects } from './list-helpers';

export const STATUS_LABEL: Record<string, string> = {
  IDEA: 'Idea',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};
const ORIGIN_LABEL: Record<string, string> = {
  GITHUB: 'GitHub',
  RESUME: 'Resume',
  MANUAL: 'Manual',
};

export interface ProjectsListViewProps {
  graph: EvidenceGraphData;
  initial: FilterState;
  notice?: string;
  error?: string;
  readOnly?: boolean;
}

export function ProjectsListView({
  graph,
  initial,
  notice,
  error,
  readOnly,
}: ProjectsListViewProps) {
  const rows = summarizeProjects(graph).sort((a, b) => a.name.localeCompare(b.name));
  const startById = new Map(graph.projects.map((p) => [p.id, p.startDate ?? '']));
  const origins = [...new Set(rows.map((r) => r.origin))];

  const items: FilterItem[] = rows.map((r) => ({
    id: r.id,
    text: `${r.name} ${r.role ?? ''}`.toLowerCase(),
    facets: { status: r.status ?? '', origin: r.origin },
    sortValues: {
      name: r.name.toLowerCase(),
      recent: startById.get(r.id) ? Date.parse(startById.get(r.id)!) : 0,
      evidence: r.evidenceCount,
    },
    node: (
      <div className="border-border bg-card hover:bg-accent/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm">
        <div className="min-w-0 flex-1 basis-56">
          <Link
            href={`/my/projects/${r.id}`}
            className="focus-visible:ring-ring rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2"
          >
            {r.name}
          </Link>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {[
              r.role,
              r.status ? STATUS_LABEL[r.status] : 'No status',
              ORIGIN_LABEL[r.origin],
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <dl className="text-muted-foreground flex items-center gap-4 text-xs">
          <div className="flex gap-1">
            <dt>Skills</dt>
            <dd className="text-foreground font-medium tabular-nums">{r.skillCount}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Evidence</dt>
            <dd className="text-foreground font-medium tabular-nums">
              {r.evidenceCount}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-1">
          <VisibilityBadge visibility={r.visibility} />
          {r.userApproved ? (
            <TonePill tone="success">Approved</TonePill>
          ) : (
            <FlagBadge>Unapproved</FlagBadge>
          )}
          {r.evidenceCount === 0 ? <FlagBadge>No evidence</FlagBadge> : null}
        </div>
      </div>
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Each project is a container for the skills, achievements, and evidence that back it."
        actions={
          <>
            <Link
              href="/my/github"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Import from GitHub
            </Link>
            <a href="#add-project" className={buttonVariants({ size: 'sm' })}>
              Add a project
            </a>
          </>
        }
      />

      <Feedback notice={notice} error={error} />

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Add one below, or import repositories from GitHub."
          action={
            <Link href="/my/github" className={buttonVariants({ size: 'sm' })}>
              Go to GitHub import
            </Link>
          }
        />
      ) : (
        <FilterableList
          label="Filter projects"
          items={items}
          initial={initial}
          search={{ label: 'Search', placeholder: 'Name or role' }}
          facets={[
            {
              param: 'status',
              label: 'Status',
              options: Object.entries(STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
            ...(origins.length > 1
              ? [
                  {
                    param: 'origin',
                    label: 'Origin',
                    kind: 'chips' as const,
                    options: origins.map((o) => ({
                      value: o,
                      label: ORIGIN_LABEL[o] ?? o,
                    })),
                  },
                ]
              : []),
          ]}
          sorts={[
            { value: 'name', label: 'Name', dir: 'asc' },
            { value: 'recent', label: 'Most recent' },
            { value: 'evidence', label: 'Most evidence' },
          ]}
          noun={{ singular: 'project', plural: 'projects' }}
        />
      )}

      <Collapsible
        id="add-project"
        title="Add a project"
        headingLevel={2}
        defaultOpen={Boolean(error) || rows.length === 0}
      >
        <Mutation readOnly={readOnly}>
          <form action={createProjectAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                name="name"
                required
                maxLength={200}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Your role</Label>
              <Input id="new-role" name="role" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-status">Status</Label>
              <Select id="new-status" name="status" defaultValue="ACTIVE">
                <option value="">Not set</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-start">Start date</Label>
              <Input id="new-start" name="startDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-end">End date</Label>
              <Input id="new-end" name="endDate" type="date" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-url">Link</Label>
              <Input
                id="new-url"
                name="url"
                type="url"
                placeholder="https://"
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-summary">Summary</Label>
              <Textarea id="new-summary" name="summary" rows={3} maxLength={4000} />
              <p className="text-muted-foreground text-xs">
                New projects start private and unapproved. You decide what they are used
                for.
              </p>
            </div>
            <div className="sm:col-span-2">
              <SubmitButton size="sm" pendingLabel="Creating…">
                Create project
              </SubmitButton>
            </div>
          </form>
        </Mutation>
      </Collapsible>
    </div>
  );
}
