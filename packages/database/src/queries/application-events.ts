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
