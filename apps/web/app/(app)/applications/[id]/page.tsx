import { getOwnApplication, listApplicationEvents } from '@career-os/database';
import { APPLICATION_STATUSES } from '@career-os/shared';
import { Button, Label, Select, StatusBadge, Textarea } from '@career-os/ui';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { changeApplicationStatus, updateApplicationNotes } from '../actions';
import { DeleteApplicationButton } from '../delete-application-button';
import { RevertEventButton } from '../revert-event-button';

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const application = await getOwnApplication(supabase, user.id, id);
  if (!application) {
    notFound();
  }
  const events = await listApplicationEvents(supabase, user.id, id);

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{application.title}</h1>
          <p className="text-muted-foreground mt-1">{application.company}</p>
        </div>
        <StatusBadge status={application.status} />
      </div>

      {application.sourceUrl || application.autofillSummary ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">Source</h2>
          <div className="text-muted-foreground space-y-1 text-sm">
            {application.sourceUrl ? (
              <p>
                <a
                  href={application.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary underline"
                >
                  Original job posting
                </a>
                {application.atsProvider ? ` · ${application.atsProvider}` : ''}
              </p>
            ) : null}
            {application.autofillSummary ? (
              <p>
                Autofill: {application.autofillSummary.filled} filled,{' '}
                {application.autofillSummary.approved} approved,{' '}
                {application.autofillSummary.skipped} skipped,{' '}
                {application.autofillSummary.failed} failed,{' '}
                {application.autofillSummary.unresolved} unresolved,{' '}
                {application.autofillSummary.manual} manual
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">Status</h2>
        <form
          action={changeApplicationStatus.bind(null, application.id)}
          className="flex items-center gap-3"
        >
          <Label htmlFor="status-select" className="sr-only">
            Status
          </Label>
          <Select
            id="status-select"
            name="status"
            defaultValue={application.status}
            className="max-w-xs"
          >
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline" size="sm">
            Update status
          </Button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">Notes</h2>
        <form
          action={updateApplicationNotes.bind(null, application.id)}
          className="space-y-2"
        >
          <Textarea name="notes" defaultValue={application.notes ?? ''} rows={4} />
          <Button type="submit" variant="outline" size="sm">
            Save notes
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Timeline</h2>
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {event.fromStatus ? `${event.fromStatus} → ` : ''}
                {event.toStatus}
                <span className="text-muted-foreground ml-2 text-xs">
                  {new Date(event.createdAt).toLocaleString()} · {event.source}
                </span>
                {event.revertedAt ? (
                  <span className="text-muted-foreground ml-2 text-xs">(reverted)</span>
                ) : null}
              </span>
              {!event.revertedAt && event.eventType === 'STATUS_CHANGE' ? (
                <RevertEventButton applicationId={application.id} eventId={event.id} />
              ) : null}
            </li>
          ))}
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events yet.</p>
          ) : null}
        </ul>
      </section>

      <section className="border-border border-t pt-6">
        <DeleteApplicationButton id={application.id} company={application.company} />
      </section>
    </div>
  );
}
