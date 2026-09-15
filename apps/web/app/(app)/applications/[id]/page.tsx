import {
  getOwnApplication,
  getOwnJobSnapshot,
  getOwnResumeVersion,
  listApplicationEvents,
  listOwnCompanyResearchSnapshotsForApplication,
  listOwnRelevantStatusChangeEventsForApplication,
} from '@career-os/database';
import { CREATABLE_APPLICATION_STATUSES, formatNextAction } from '@career-os/shared';
import { Button, Label, Select, StatusBadge, Textarea } from '@career-os/ui';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { attachNextActions } from '../../../../lib/dashboard';
import { createClient } from '../../../../lib/supabase/server';
import { changeApplicationStatus, updateApplicationNotes } from '../actions';
import { CompanyResearchSection } from '../company-research-section';
import { DeleteApplicationButton } from '../delete-application-button';
import { FollowUpDraftPanel } from '../follow-up-draft-panel';
import { InterviewPrepPanel } from '../interview-prep-panel';
import { MarkAppliedPanel } from '../mark-applied-panel';
import { PeopleSection } from '../people-section';
import { RequirementAnalysisPanel } from '../requirement-analysis-panel';
import { ResumeSection } from '../resume-section';
import { ResumeTailoringPanel } from '../resume-tailoring-panel';
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

  // Phase 5C.4 performance audit: these three reads are mutually independent (the only one that
  // depends on `application` is jobSnapshot, and only on `jobSnapshotId`, already known) — fetch
  // them together rather than serially. Phase 5C.3C's own rationale for the third read is
  // unchanged: this page only ever uses the deterministic engine to decide whether to *show* an
  // AI-assistance panel at all; the routes those panels call independently re-derive this same
  // decision server-side before ever calling Claude, so hiding/showing a button here is purely a
  // UX nicety, never the actual eligibility gate.
  const [
    events,
    jobSnapshot,
    relevantStatusChangeEvents,
    workingResumeVersion,
    companyResearchSnapshots,
  ] = await Promise.all([
    listApplicationEvents(supabase, user.id, id),
    application.jobSnapshotId
      ? getOwnJobSnapshot(supabase, user.id, application.jobSnapshotId)
      : Promise.resolve(null),
    listOwnRelevantStatusChangeEventsForApplication(supabase, user.id, id),
    application.workingResumeVersionId
      ? getOwnResumeVersion(supabase, user.id, application.workingResumeVersionId)
      : Promise.resolve(null),
    listOwnCompanyResearchSnapshotsForApplication(supabase, user.id, id),
  ]);
  // Phase 7H — purely informational for the tailoring panel's mode selector (§35): the panel's
  // own API route independently re-resolves and re-validates any snapshot id server-side before
  // ever using it (§6/§7), so this is never treated as authoritative on its own.
  const latestCompanyResearch = companyResearchSnapshots[0]
    ? { id: companyResearchSnapshots[0].id, researchedAt: companyResearchSnapshots[0].researchedAt }
    : null;
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

      <section id="mark-applied-panel" className="space-y-3">
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

      <ResumeSection
        supabase={supabase}
        userId={user.id}
        applicationId={application.id}
        workingResumeVersionId={application.workingResumeVersionId}
        company={application.company}
        title={application.title}
      />

      {/* Phase 7E — shown only when there is a working résumé with real structured content to
          tailor; a METADATA_ONLY version (or no working résumé at all) has nothing this pipeline
          could operate on. This is purely a UX nicety: the API route's own pipeline independently
          re-derives and re-checks the exact same condition server-side before ever calling Claude
          (same posture as the deterministic-next-action panels above, see that block's own
          comment). */}
      {workingResumeVersion?.snapshotFormat === 'STRUCTURED_V1' ? (
        <ResumeTailoringPanel
          applicationId={application.id}
          latestCompanyResearch={latestCompanyResearch}
        />
      ) : null}

      {/* Phase 7G — company research is a separate, RESEARCH ONLY flow (docs/
          IMPLEMENTATION_PLAN.md "Phase 7G"): it never reads or affects the résumé/tailoring
          sections above, never runs automatically, and only ever generates on an explicit click
          inside this section. */}
      <CompanyResearchSection supabase={supabase} userId={user.id} applicationId={application.id} />

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

      {/* Phase 5C.4 — the `id` attributes below let dashboard action rows link straight to the
          relevant panel (e.g. `/applications/:id#follow-up-draft-panel`) using plain HTML
          fragment scrolling, no query-param eligibility hint of any kind: the server above has
          already independently decided whether to render each panel at all, so a fragment can
          only ever point at something that's actually there — it can never bypass the real
          eligibility check either panel's own API route performs again on click. */}
      {nextAction.type === 'CONSIDER_FOLLOW_UP' ? (
        <div id="follow-up-draft-panel">
          <FollowUpDraftPanel applicationId={application.id} />
        </div>
      ) : null}

      {nextAction.type === 'PREPARE_INTERVIEW' ? (
        <div id="interview-prep-panel">
          <InterviewPrepPanel applicationId={application.id} />
        </div>
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

      <PeopleSection
        supabase={supabase}
        userId={user.id}
        applicationId={application.id}
        company={application.company}
      />

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
