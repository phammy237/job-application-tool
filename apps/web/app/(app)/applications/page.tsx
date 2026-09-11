import { listOwnApplications } from '@career-os/database';
import {
  APPLICATION_STATUSES,
  CREATABLE_APPLICATION_STATUSES,
  type ApplicationStatus,
} from '@career-os/shared';
import { Button, Input, Label, Select, StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { createApplication } from './actions';

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const applications = await listOwnApplications(supabase, user.id, {
    status: status ? (status as ApplicationStatus) : undefined,
    search: q || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {applications.length} application{applications.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q ?? ''} placeholder="Company or title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add application</summary>
        <form action={createApplication} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-company">Company</Label>
            <Input id="new-company" name="company" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-title">Title</Label>
            <Input id="new-title" name="title" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-status">Status</Label>
            {/* APPLIED is deliberately excluded — an application reaches APPLIED only through the
                canonical "Mark as Applied" action, never generic creation (see
                docs/IMPLEMENTATION_PLAN.md Phase 5B.0). CREATABLE_APPLICATION_STATUSES is also the
                actual server-side trust boundary (createOwnApplication's input type), so this isn't
                merely hiding the option — the server rejects it too. */}
            <Select id="new-status" name="status" defaultValue="SAVED">
              {CREATABLE_APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit">Add application</Button>
          </div>
        </form>
      </details>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-border bg-muted/50 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id} className="border-border border-b last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/applications/${application.id}`}
                    className="hover:text-primary font-medium hover:underline"
                  >
                    {application.company}
                  </Link>
                </td>
                <td className="px-4 py-3">{application.title}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={application.status} />
                </td>
                <td className="text-muted-foreground px-4 py-3">
                  {new Date(application.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {applications.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-4 py-8 text-center">
                  No applications yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
