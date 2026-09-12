import {
  getOwnApplication,
  getOwnJobSnapshot,
  listApplicationEvents,
  listOwnRelevantStatusChangeEventsForApplication,
} from '@career-os/database';
import { CREATABLE_APPLICATION_STATUSES, formatNextAction } from '@career-os/shared';
import { Button, Label, Select, StatusBadge, Textarea } from '@career-os/ui';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { attachNextActions } from '../../../../lib/dashboard';
import { createClient } from '../../../../lib/supabase/server';
import { changeApplicationStatus, updateApplicationNotes } from '../actions';
import { DeleteApplicationButton } from '../delete-application-button';
import { FollowUpDraftPanel } from '../follow-up-draft-panel';
import { InterviewPrepPanel } from '../interview-prep-panel';
import { MarkAppliedPanel } from '../mark-applied-panel';
import { RequirementAnalysisPanel } from '../requirement-analysis-panel';
import { RevertEventButton } from '../revert-event-button';
import { SubmissionPacketSection } from '../submission-packet-section';

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
  const jobSnapshot = application.jobSnapshotId
    ? await getOwnJobSnapshot(supabase, user.id, application.jobSnapshotId)
    : null;

  // Phase 5C.3C — this page only ever uses the deterministic engine to decide whether to *show*
  // an AI-assistance panel at all; the routes those panels call independently re-derive this same
  // decision server-side before ever calling Claude (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3C"),
  // so hiding/showing a button here is purely a UX nicety, never the actual eligibility gate.
  const relevantStatusChangeEvents =
    await listOwnRelevantStatusChangeEventsForApplication(supabase, user.id, id);
  const [applicationWithNextAction] = attachNextActions(
    [application],
    relevantStatusChangeEvents,
    new Date().toISOString(),
  );
  // Unreachable: attachNextActions maps 1:1 over its input, which here is always a one-element
  // array.
  if (!applicationWithNextAction) {
    throw new Error('attachNextActions returned no result for a single application');
  }
  const { nextAction } = applicationWithNextAction;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{application.title}</h1>
          <p className="text-muted-foreground mt-1">
            {application.company}
            {application.location ? ` · ${application.location}` : ''}
          </p>
        </div>
        <StatusBadge status={application.status} />
      </div>

      {/* Phase 5C.3F — the deterministic reason is always shown, even where an AI-assistance
          panel also appears below: the AI draft/prep is help on top of this decision, never a
          replacement for showing it (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3F"). */}
      <p className="text-muted-foreground text-sm">
        {formatNextAction(nextAction).reason}
      </p>

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

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Status</h2>
        {/* APPLIED is deliberately excluded from this generic control — it has its own dedicated
            review flow below (docs/IMPLEMENTATION_PLAN.md Phase 5B.2H), since reaching APPLIED may
            require reviewing and acknowledging consistency findings first. */}
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
            defaultValue={
              application.status === 'APPLIED' ? 'APPLIED' : application.status
            }
            className="max-w-xs"
          >
            {application.status === 'APPLIED' ? (
              <option value="APPLIED">APPLIED</option>
            ) : null}
            {CREATABLE_APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline" size="sm">
            Update status
          </Button>
        </form>

        {application.status !== 'APPLIED' ? (
          <MarkAppliedPanel applicationId={application.id} />
        ) : null}
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

      {nextAction.type === 'CONSIDER_FOLLOW_UP' ? (
        <FollowUpDraftPanel applicationId={application.id} />
      ) : null}

      {nextAction.type === 'PREPARE_INTERVIEW' ? (
        <InterviewPrepPanel applicationId={application.id} />
      ) : null}

      {application.jobSnapshotId ? (
        <RequirementAnalysisPanel
          jobSnapshotId={application.jobSnapshotId}
          contentTruncated={jobSnapshot?.contentTruncated ?? false}
          truncatedFields={jobSnapshot?.truncatedFields ?? []}
        />
      ) : null}

      {application.status === 'APPLIED' ? (
        <SubmissionPacketSection
          supabase={supabase}
          userId={user.id}
          applicationId={application.id}
        />
      ) : null}

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
