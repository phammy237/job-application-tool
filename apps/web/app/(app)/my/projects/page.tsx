import { loadOwnEvidenceGraph } from '@career-os/database';
import { Badge, Input, Label, Select, Textarea } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { EmptyState, FlagBadge, VisibilityBadge } from '../_components/badges';
import { createProjectAction } from './actions';
import { Feedback, firstParam } from './_components/feedback';
import { SubmitButton } from './_components/submit-button';
import { filterProjects, summarizeProjects } from './list-helpers';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const STATUS_LABEL: Record<string, string> = {
  IDEA: 'Idea',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export default async function MyProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = firstParam(params.q) ?? '';
  const status = firstParam(params.status) ?? '';
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);

  const user = await requireUser();
  const supabase = await createClient();
  const graph = await loadOwnEvidenceGraph(supabase, user.id);

  const rows = summarizeProjects(graph);
  const visible = filterProjects(rows, { q, status });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.length} {rows.length === 1 ? 'project' : 'projects'}
            {visible.length !== rows.length ? `, ${visible.length} shown` : ''}. Each one is a
            container for the skills, achievements, and evidence that back it.
          </p>
        </div>
      </header>

      <Feedback notice={notice} error={error} />

      <details className="border-border bg-card rounded-lg border" open={Boolean(error)}>
        <summary className="focus-visible:ring-ring cursor-pointer rounded-lg px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
          Add a project
        </summary>
        <form action={createProjectAction} className="grid gap-3 border-t p-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" name="name" required maxLength={200} autoComplete="off" />
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
            <Input id="new-url" name="url" type="url" placeholder="https://" maxLength={500} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="new-summary">Summary</Label>
            <Textarea id="new-summary" name="summary" rows={3} maxLength={4000} />
            <p className="text-muted-foreground text-xs">
              New projects start private and unapproved. You decide what they are used for.
            </p>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton size="sm" pendingLabel="Creating…">
              Create project
            </SubmitButton>
          </div>
        </form>
      </details>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter projects">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Name or role" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton size="sm" variant="outline" pendingLabel="Filtering…">
          Apply
        </SubmitButton>
        {q || status ? (
          <Link href="/my/projects" className="text-primary pb-2 text-sm hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Add one above, or import repositories from GitHub."
          action={
            <Link href="/my/github" className="text-primary text-sm hover:underline">
              Go to GitHub import
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No projects match" description="Try a different search or status." />
      ) : (
        <div className="border-border bg-card divide-border divide-y rounded-lg border">
          <div
            className="text-muted-foreground hidden grid-cols-[minmax(0,2fr)_6rem_5rem_4rem_4rem_minmax(0,1.2fr)] gap-3 px-4 py-2 text-xs font-medium md:grid"
            aria-hidden="true"
          >
            <span>Name</span>
            <span>Status</span>
            <span>Origin</span>
            <span>Skills</span>
            <span>Evidence</span>
            <span>Flags</span>
          </div>
          <ul className="divide-border divide-y">
            {visible.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-sm md:grid-cols-[minmax(0,2fr)_6rem_5rem_4rem_4rem_minmax(0,1.2fr)] md:items-center"
              >
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <Link
                    href={`/my/projects/${r.id}`}
                    className="font-medium hover:underline focus-visible:underline"
                  >
                    {r.name}
                  </Link>
                  {r.role ? <p className="text-muted-foreground truncate text-xs">{r.role}</p> : null}
                </div>
                <span className="text-muted-foreground">
                  <span className="md:hidden">Status: </span>
                  {r.status ? STATUS_LABEL[r.status] : 'Not set'}
                </span>
                <span>
                  <Badge variant="outline">{r.origin === 'GITHUB' ? 'GitHub' : r.origin === 'RESUME' ? 'Resume' : 'Manual'}</Badge>
                </span>
                <span className="text-muted-foreground">
                  <span className="md:hidden">Skills: </span>
                  {r.skillCount}
                </span>
                <span className="text-muted-foreground">
                  <span className="md:hidden">Evidence: </span>
                  {r.evidenceCount}
                </span>
                <span className="col-span-2 flex flex-wrap items-center gap-1 md:col-span-1">
                  <VisibilityBadge visibility={r.visibility} />
                  {!r.userApproved ? <FlagBadge>Unapproved</FlagBadge> : null}
                  {r.evidenceCount === 0 ? <FlagBadge>No evidence</FlagBadge> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
