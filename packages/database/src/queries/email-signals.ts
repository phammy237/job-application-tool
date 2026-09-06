import {
  EMAIL_CLASSIFICATION_TO_STATUS,
  emailSignalSchema,
  type EmailClassification,
  type EmailSignal,
  type EmailSignalConfirmationStatus,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { changeOwnApplicationStatus } from './applications';

function rowToEmailSignal(row: {
  id: string;
  user_id: string;
  email_connection_id: string;
  provider_message_id: string;
  sender: string | null;
  sender_domain: string | null;
  subject: string | null;
  received_at: string | null;
  matched_application_id: string | null;
  classification: string | null;
  confidence: number | null;
  evidence: string | null;
  confirmation_status: string;
  processed_at: string;
}): EmailSignal {
  return emailSignalSchema.parse({
    id: row.id,
    userId: row.user_id,
    emailConnectionId: row.email_connection_id,
    providerMessageId: row.provider_message_id,
    sender: row.sender,
    senderDomain: row.sender_domain,
    subject: row.subject,
    receivedAt: row.received_at,
    matchedApplicationId: row.matched_application_id,
    classification: row.classification,
    confidence: row.confidence,
    evidence: row.evidence,
    confirmationStatus: row.confirmation_status,
    processedAt: row.processed_at,
  });
}

export async function listOwnEmailSignalsNeedingConfirmation(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<EmailSignal[]> {
  const { data, error } = await supabase
    .from('email_signals')
    .select('*')
    .eq('user_id', userId)
    .eq('confirmation_status', 'PENDING')
    .order('received_at', { ascending: false });
  assertNoError(error, 'listOwnEmailSignalsNeedingConfirmation');
  return (data ?? []).map(rowToEmailSignal);
}

/** Every signal for the user, across all applications — used once per sync (not per message) by
 * packages/email's matcher to build its learned-ATS-sending-domain map, which needs visibility
 * across every application's prior signals, not just one. */
export async function listOwnEmailSignals(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<EmailSignal[]> {
  const { data, error } = await supabase.from('email_signals').select('*').eq('user_id', userId);
  assertNoError(error, 'listOwnEmailSignals');
  return (data ?? []).map(rowToEmailSignal);
}

export async function listOwnEmailSignalsForApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<EmailSignal[]> {
  const { data, error } = await supabase
    .from('email_signals')
    .select('*')
    .eq('user_id', userId)
    .eq('matched_application_id', applicationId)
    .order('received_at', { ascending: false });
  assertNoError(error, 'listOwnEmailSignalsForApplication');
  return (data ?? []).map(rowToEmailSignal);
}

/**
 * Used by the sync orchestrator (packages/email/src/sync.ts) to skip already-seen messages
 * *before* calling Gmail's messages.get for each one — not just relying on the DB's dedup
 * unique constraint to reject the eventual insert, which would waste a Gmail API call and a
 * classification pass on a message that's certain to be discarded.
 */
export async function listOwnProcessedMessageIds(
  supabase: CareerOsSupabaseClient,
  userId: string,
  emailConnectionId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('email_signals')
    .select('provider_message_id')
    .eq('user_id', userId)
    .eq('email_connection_id', emailConnectionId);
  assertNoError(error, 'listOwnProcessedMessageIds');
  return new Set((data ?? []).map((row) => row.provider_message_id));
}

export interface CreateEmailSignalInput {
  emailConnectionId: string;
  providerMessageId: string;
  sender: string | null;
  senderDomain: string | null;
  subject: string | null;
  receivedAt: string | null;
  matchedApplicationId: string | null;
  classification: EmailClassification | null;
  confidence: number | null;
  evidence: string | null;
  confirmationStatus: EmailSignalConfirmationStatus;
}

export async function createOwnEmailSignal(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreateEmailSignalInput,
): Promise<EmailSignal> {
  const { data, error } = await supabase
    .from('email_signals')
    .insert({
      user_id: userId,
      email_connection_id: input.emailConnectionId,
      provider_message_id: input.providerMessageId,
      sender: input.sender,
      sender_domain: input.senderDomain,
      subject: input.subject,
      received_at: input.receivedAt,
      matched_application_id: input.matchedApplicationId,
      classification: input.classification,
      confidence: input.confidence,
      evidence: input.evidence,
      confirmation_status: input.confirmationStatus,
    })
    .select('*')
    .single();
  return rowToEmailSignal(unwrapRow(data, error, 'createOwnEmailSignal'));
}

/**
 * CONFIRM: optionally redirects matched_application_id first (the ambiguous-match case, where
 * the user picked a different application than the stored top match), then updates the
 * application's status via the exact same changeOwnApplicationStatus call the sync path's
 * AUTO_APPLIED case uses (source: 'GMAIL_SYNC', emailSignalId set) — so both paths funnel through
 * one status-change+event-recording call and the existing undo mechanism
 * (revertApplicationEvent/RevertEventButton) covers both with no new code. DECLINE only ever sets
 * confirmation_status — it never touches applications or application_events.
 */
export async function confirmOwnEmailSignal(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  decision: { action: 'CONFIRM' | 'DECLINE'; applicationId?: string },
): Promise<EmailSignal> {
  const { data: signalRow, error: fetchError } = await supabase
    .from('email_signals')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(fetchError, 'confirmOwnEmailSignal (fetch)');
  if (!signalRow) {
    throw new DatabaseError('Email signal not found or not owned by this user.');
  }
  const signal = rowToEmailSignal(signalRow);

  if (decision.action === 'DECLINE') {
    const { data, error } = await supabase
      .from('email_signals')
      .update({ confirmation_status: 'DECLINED' })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    return rowToEmailSignal(unwrapRow(data, error, 'confirmOwnEmailSignal (decline)'));
  }

  const applicationId = decision.applicationId ?? signal.matchedApplicationId;
  if (!applicationId) {
    throw new DatabaseError('Cannot confirm an email signal with no matched application.');
  }
  const toStatus = signal.classification ? EMAIL_CLASSIFICATION_TO_STATUS[signal.classification] : null;
  if (!toStatus) {
    throw new DatabaseError('Cannot confirm an email signal with no actionable classification.');
  }

  // changeOwnApplicationStatus internally re-fetches via getOwnApplication, which filters by
  // both id and user_id — this is the ownership check for a caller-supplied applicationId
  // (the ambiguous-match redirect case). It runs *before* the signal row is ever touched below,
  // so a request naming an application the caller doesn't own throws here and leaves the signal
  // row completely unmodified, rather than first writing an unverified matched_application_id
  // and only failing afterward.
  await changeOwnApplicationStatus(supabase, userId, applicationId, toStatus, {
    source: 'GMAIL_SYNC',
    emailSignalId: id,
  });

  if (applicationId !== signal.matchedApplicationId) {
    const { error: redirectError } = await supabase
      .from('email_signals')
      .update({ matched_application_id: applicationId })
      .eq('id', id)
      .eq('user_id', userId);
    assertNoError(redirectError, 'confirmOwnEmailSignal (redirect match)');
  }

  const { data, error } = await supabase
    .from('email_signals')
    .update({ confirmation_status: 'CONFIRMED' })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToEmailSignal(unwrapRow(data, error, 'confirmOwnEmailSignal (confirm)'));
}
