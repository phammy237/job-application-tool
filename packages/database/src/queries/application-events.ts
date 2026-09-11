import {
  applicationEventSchema,
  type ApplicationEvent,
  type ApplicationEventSource,
  type ApplicationEventType,
  type ApplicationStatus,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['application_events']['Row'];

function rowToEvent(row: Row): ApplicationEvent {
  return applicationEventSchema.parse({
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    source: row.source,
    emailSignalId: row.email_signal_id,
    revertedAt: row.reverted_at,
    createdAt: row.created_at,
  });
}

export async function listApplicationEvents(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<ApplicationEvent[]> {
  const { data, error } = await supabase
    .from('application_events')
    .select('*')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listApplicationEvents');
  return (data ?? []).map(rowToEvent);
}

/**
 * Recent events across every one of the user's applications, in one query — the dashboard's
 * "Recent activity" section (docs/IMPLEMENTATION_PLAN.md "Phase 5C.2F") needs this exact shape:
 * one bounded fetch, not one query per application (which would be the N+1
 * docs/IMPLEMENTATION_PLAN.md "Phase 5C.2H" explicitly calls out to avoid). The caller maps
 * `applicationId` back to a company/title using the applications list it already has, rather
 * than this query embedding a join.
 */
export async function listOwnRecentApplicationEvents(
  supabase: CareerOsSupabaseClient,
  userId: string,
  limit: number,
): Promise<ApplicationEvent[]> {
  const { data, error } = await supabase
    .from('application_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  assertNoError(error, 'listOwnRecentApplicationEvents');
  return (data ?? []).map(rowToEvent);
}

export async function recordApplicationEvent(
  supabase: CareerOsSupabaseClient,
  userId: string,
  event: {
    applicationId: string;
    eventType: ApplicationEventType;
    fromStatus: ApplicationStatus | null;
    toStatus: ApplicationStatus | null;
    source: ApplicationEventSource;
    emailSignalId?: string | null;
  },
): Promise<ApplicationEvent> {
  const { data, error } = await supabase
    .from('application_events')
    .insert({
      user_id: userId,
      application_id: event.applicationId,
      event_type: event.eventType,
      from_status: event.fromStatus,
      to_status: event.toStatus,
      source: event.source,
      email_signal_id: event.emailSignalId ?? null,
    })
    .select('*')
    .single();
  return rowToEvent(unwrapRow(data, error, 'recordApplicationEvent'));
}

/**
 * Undo for a status-change event: reverts the application's status back to the event's
 * fromStatus, marks the original event as reverted, and records a new SYSTEM-sourced event
 * documenting the revert. See docs/USER_FLOWS.md §6 "Undo for automated updates" — this same
 * mechanism also covers undoing a manual change made by mistake.
 *
 * Phase 5B hardening (docs/IMPLEMENTATION_PLAN.md "Phase 5B hardening"): restoring APPLIED is the
 * one accepted exception to "only mark_application_applied produces APPLIED" — a pre-existing,
 * unchanged Phase 5B invariant. Migration 0015 added a database trigger that rejects any direct
 * write moving `applications.status`/`applied_at`/`submission_packet_id` toward APPLIED unless
 * the executing role is `service_role`, so this function's caller (`apps/web`'s `revertEvent`
 * action) now passes the admin/service-role client — exactly the same pattern already used for
 * `markOwnApplicationApplied`/`changeApplicationStatus`'s APPLIED branch, and safe for the same
 * reason: every write below is already independently filtered by `user_id`, never relying on RLS
 * as the sole authorization boundary.
 *
 * That alone is not sufficient, though: `application_events` keeps its ordinary `authenticated`
 * insert policy unchanged (legitimate code also records real events with `from_status='APPLIED'`
 * whenever a real application moves away from APPLIED to something else, via the session-scoped
 * client), so a user could otherwise insert a *fabricated* `application_events` row
 * (`event_type='STATUS_CHANGE', from_status='APPLIED', reverted_at=null`) for an application that
 * was never actually applied, then call this exact revert flow on it to manufacture a fake
 * APPLIED state without ever going through `mark_application_applied`. The check below closes
 * that: it never trusts the event log's `fromStatus` alone as proof of a genuine history — it
 * additionally requires the *current* application row's own `applied_at` to already be non-null,
 * which (thanks to the same migration 0015 trigger) can only ever have been set by
 * `mark_application_applied` in the first place. A fabricated event pointing at an application
 * that was never genuinely applied fails this check and the revert is refused, while a real
 * historical APPLIED state — including a pre-Phase-5B.1 legacy application, which still has
 * `applied_at` set by whatever code produced it at the time — passes correctly.
 */
export async function revertApplicationEvent(
  supabase: CareerOsSupabaseClient,
  userId: string,
  eventId: string,
): Promise<ApplicationEvent> {
  const { data: eventRow, error: fetchError } = await supabase
    .from('application_events')
    .select('*')
    .eq('id', eventId)
    .eq('user_id', userId)
    .single();
  const event = rowToEvent(
    unwrapRow(eventRow, fetchError, 'revertApplicationEvent (fetch)'),
  );

  if (event.eventType !== 'STATUS_CHANGE') {
    throw new Error('Only STATUS_CHANGE events can be reverted.');
  }
  if (event.revertedAt) {
    throw new Error('This event has already been reverted.');
  }

  if (event.fromStatus === 'APPLIED') {
    const { data: currentRow, error: currentError } = await supabase
      .from('applications')
      .select('applied_at')
      .eq('id', event.applicationId)
      .eq('user_id', userId)
      .maybeSingle();
    assertNoError(currentError, 'revertApplicationEvent (applied_at verification)');
    if (!currentRow || currentRow.applied_at === null) {
      throw new Error(
        'Cannot revert to APPLIED: this application has no record of ever having been ' +
          'genuinely applied (applied_at is null) — refusing to trust the event log alone.',
      );
    }
  }

  const { error: appUpdateError } = await supabase
    .from('applications')
    .update({ status: event.fromStatus ?? 'SAVED' })
    .eq('id', event.applicationId)
    .eq('user_id', userId);
  assertNoError(appUpdateError, 'revertApplicationEvent (application update)');

  const { error: markRevertedError } = await supabase
    .from('application_events')
    .update({ reverted_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('user_id', userId);
  assertNoError(markRevertedError, 'revertApplicationEvent (mark reverted)');

  return recordApplicationEvent(supabase, userId, {
    applicationId: event.applicationId,
    eventType: 'STATUS_CHANGE',
    fromStatus: event.toStatus,
    toStatus: event.fromStatus,
    source: 'SYSTEM',
  });
}
