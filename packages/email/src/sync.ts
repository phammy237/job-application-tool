import {
  changeOwnApplicationStatus,
  createOwnEmailSignal,
  decryptRefreshToken,
  getOwnEmailConnectionWithToken,
  listOwnApplications,
  listOwnEmailSignals,
  listOwnProcessedMessageIds,
  updateOwnEmailConnectionAfterSync,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { classifyEmail } from '@career-os/ai';
import { EMAIL_CLASSIFICATION_TO_STATUS, type EmailSignalConfirmationStatus } from '@career-os/shared';
import { GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SYNC } from './config';
import { classifyDeterministic } from './deterministic-classifier';
import { getMessageMetadata, searchMessages } from './gmail-client';
import { matchApplication } from './matcher';
import { refreshAccessToken } from './oauth';

export type RunGmailSyncResult =
  | { status: 'no_connection' }
  | {
      status: 'synced';
      processed: number;
      autoApplied: number;
      needsConfirmation: number;
      skipped: number;
      errors: Array<{ messageId: string; message: string }>;
    };

const AUTO_APPLY_THRESHOLD = 0.85;

/**
 * Single synchronous request/response, capped at MAX_MESSAGES_PER_SYNC — no background jobs or
 * streaming, matching docs/EMAIL_INTEGRATION.md's manual/click-triggered-only requirement. A
 * user needing more just clicks Sync Gmail again; the dedup constraint + last_synced_at make
 * repeated syncs cheap and safe, giving free "pagination."
 */
export async function runGmailSync(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<RunGmailSyncResult> {
  const connection = await getOwnEmailConnectionWithToken(supabase, userId);
  if (!connection) {
    return { status: 'no_connection' };
  }

  let accessToken: string;
  try {
    const refreshToken = decryptRefreshToken(connection.encryptedRefreshToken);
    accessToken = await refreshAccessToken(refreshToken);
  } catch (error) {
    await updateOwnEmailConnectionAfterSync(supabase, userId, {
      lastSyncedAt: new Date().toISOString(),
      status: 'ERROR',
    });
    throw error;
  }

  const [applications, priorSignals, processedMessageIds, searchResults] = await Promise.all([
    listOwnApplications(supabase, userId),
    listOwnEmailSignals(supabase, userId),
    listOwnProcessedMessageIds(supabase, userId, connection.id),
    searchMessages(accessToken, GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SYNC),
  ]);

  const unseenMessages = searchResults.filter((m) => !processedMessageIds.has(m.id));

  let processed = 0;
  let autoApplied = 0;
  let needsConfirmation = 0;
  let skipped = 0;
  const errors: Array<{ messageId: string; message: string }> = [];

  for (const { id: messageId } of unseenMessages) {
    try {
      const metadata = await getMessageMetadata(accessToken, messageId);

      const deterministic = classifyDeterministic({
        subject: metadata.subject,
        snippet: metadata.snippet,
      });
      let classification = deterministic?.classification ?? null;
      let classificationConfidence = deterministic?.confidence ?? null;
      let evidence = deterministic?.evidence ?? null;

      if (!deterministic) {
        const claudeResult = await classifyEmail(supabase, userId, {
          sender: metadata.sender ?? '(unknown sender)',
          subject: metadata.subject ?? '(no subject)',
          snippet: metadata.snippet,
        });
        if (claudeResult.status === 'classified') {
          classification = claudeResult.classification;
          classificationConfidence = claudeResult.confidence;
          evidence = claudeResult.evidence;
        }
        // rate_limited/provider_error/validation_failed all fall through with classification
        // still null — the message is stored unclassified/NOT_APPLICABLE rather than guessed.
      }

      const match = matchApplication(
        { sender: metadata.sender, senderDomain: metadata.senderDomain, subject: metadata.subject },
        applications,
        priorSignals,
      );

      const toStatus = classification ? EMAIL_CLASSIFICATION_TO_STATUS[classification] : null;
      const combinedConfidence =
        classificationConfidence !== null ? Math.min(classificationConfidence, match.score) : null;

      let confirmationStatus: EmailSignalConfirmationStatus;
      if (!match.applicationId || !toStatus || combinedConfidence === null) {
        confirmationStatus = 'NOT_APPLICABLE';
      } else if (!match.ambiguous && combinedConfidence >= AUTO_APPLY_THRESHOLD) {
        confirmationStatus = 'AUTO_APPLIED';
      } else {
        confirmationStatus = 'PENDING';
      }

      const signal = await createOwnEmailSignal(supabase, userId, {
        emailConnectionId: connection.id,
        providerMessageId: messageId,
        sender: metadata.sender,
        senderDomain: metadata.senderDomain,
        subject: metadata.subject,
        receivedAt: metadata.receivedAt,
        matchedApplicationId: match.applicationId,
        classification,
        confidence: combinedConfidence,
        evidence,
        confirmationStatus,
      });

      if (confirmationStatus === 'AUTO_APPLIED' && match.applicationId && toStatus) {
        await changeOwnApplicationStatus(supabase, userId, match.applicationId, toStatus, {
          source: 'GMAIL_SYNC',
          emailSignalId: signal.id,
        });
        autoApplied += 1;
      } else if (confirmationStatus === 'PENDING') {
        needsConfirmation += 1;
      } else {
        skipped += 1;
      }
      processed += 1;
    } catch (error) {
      errors.push({
        messageId,
        message: error instanceof Error ? error.message : 'Unknown error processing message',
      });
    }
  }

  await updateOwnEmailConnectionAfterSync(supabase, userId, {
    lastSyncedAt: new Date().toISOString(),
    status: 'ACTIVE',
  });

  return { status: 'synced', processed, autoApplied, needsConfirmation, skipped, errors };
}
