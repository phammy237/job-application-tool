import {
  changeOwnApplicationStatus,
  createAutoTrackedApplicationFromEmail,
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
import { extractApplicationIdentity } from './extract-application-identity';
import { getMessageMetadata, searchMessages } from './gmail-client';
import { matchApplication } from './matcher';
import { refreshAccessToken } from './oauth';

export interface RunGmailSyncOptions {
  /**
   * Off by default — preserves the manual "Sync Gmail" route's exact existing behavior (never
   * creates a new application, only updates ones you already track). The background cron job
   * (migration 0046, /api/cron/gmail-background-sync) is the one caller that passes true, and
   * only for a user who separately opted into background tracking specifically.
   */
  allowAutoCreate?: boolean;
}

export type RunGmailSyncResult =
  | { status: 'no_connection' }
  | {
      status: 'synced';
      processed: number;
      autoApplied: number;
      needsConfirmation: number;
      skipped: number;
      /** Only ever non-zero when options.allowAutoCreate is true. */
      autoCreated: number;
      errors: Array<{ messageId: string; message: string }>;
    };

const AUTO_APPLY_THRESHOLD = 0.85;
/** Same bar as AUTO_APPLY_THRESHOLD, applied to classification confidence alone (there is no
 * match score to combine it with — see the auto-create branch below) — auto-*creating* an
 * application the user never asked Career OS to track is a bigger, harder-to-undo action than
 * auto-*updating* one they already track, so it gets the same high bar, never a lower one. */
const AUTO_CREATE_THRESHOLD = AUTO_APPLY_THRESHOLD;

/**
 * Single synchronous request/response, capped at MAX_MESSAGES_PER_SYNC — no background jobs or
 * streaming, matching docs/EMAIL_INTEGRATION.md's attended-only requirement (a manual click or
 * the throttled auto-check on page load — never unattended). A user needing more just clicks
 * Sync Gmail again; the dedup constraint + last_synced_at make repeated syncs cheap and safe,
 * giving free "pagination."
 *
 * `supabase` is the caller's session-scoped (RLS) client and handles every connection/signal
 * read and write. `aiClient` must be the service-role client: it's used only for the Claude
 * fallback classifier, whose quota reserve/refund RPCs are service-role only (migration 0044).
 * Every call on it passes this same session-derived `userId`.
 */
export async function runGmailSync(
  supabase: CareerOsSupabaseClient,
  userId: string,
  aiClient: CareerOsSupabaseClient,
  options: RunGmailSyncOptions = {},
): Promise<RunGmailSyncResult> {
  const allowAutoCreate = options.allowAutoCreate ?? false;
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

  // Fetched concurrently — each is an independent, read-only Gmail API call with no ordering
  // dependency on any other, so awaiting them one at a time inside the loop below (as earlier
  // versions of this function did) only ever adds pure network latency with no corresponding
  // benefit. A failed fetch is captured per-message here, same as every other per-message
  // failure, so one bad message still can't abort the batch.
  const metadataResults = await Promise.all(
    unseenMessages.map(
      async ({
        id: messageId,
      }): Promise<
        | { messageId: string; status: 'ok'; metadata: Awaited<ReturnType<typeof getMessageMetadata>> }
        | { messageId: string; status: 'error'; message: string }
      > => {
        try {
          return { messageId, status: 'ok', metadata: await getMessageMetadata(accessToken, messageId) };
        } catch (error) {
          return {
            messageId,
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error fetching message',
          };
        }
      },
    ),
  );

  let processed = 0;
  let autoApplied = 0;
  let needsConfirmation = 0;
  let skipped = 0;
  let autoCreated = 0;
  const errors: Array<{ messageId: string; message: string }> = [];

  // Everything from here on stays sequential, deliberately: classification can call Claude
  // (rate/quota-sensitive) and, more importantly, auto-creation reads and writes the same
  // `applications` list across iterations (pushed to immediately below) — running these
  // concurrently would let two unmatched messages for the same new company both see "no
  // match yet" and each create a duplicate application. The expensive, purely independent
  // network fetch above is where the real wall-clock win is; this part is comparatively fast
  // local work plus occasional short DB/Claude calls.
  for (const metadataResult of metadataResults) {
    if (metadataResult.status === 'error') {
      errors.push({ messageId: metadataResult.messageId, message: metadataResult.message });
      continue;
    }
    const { messageId, metadata } = metadataResult;
    try {
      const deterministic = classifyDeterministic({
        subject: metadata.subject,
        snippet: metadata.snippet,
      });
      let classification = deterministic?.classification ?? null;
      let classificationConfidence = deterministic?.confidence ?? null;
      let evidence = deterministic?.evidence ?? null;

      if (!deterministic) {
        const claudeResult = await classifyEmail(aiClient, userId, {
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

      // Auto-creation only ever applies when there is no existing match at all — a message that
      // matches *something*, even ambiguously, always goes through the ordinary update/pending
      // path below, never creates a second, duplicate application alongside it.
      const identity =
        allowAutoCreate &&
        !match.applicationId &&
        classification === 'APPLICATION_RECEIVED' &&
        classificationConfidence !== null &&
        classificationConfidence >= AUTO_CREATE_THRESHOLD
          ? extractApplicationIdentity({ sender: metadata.sender, subject: metadata.subject })
          : null;

      let confirmationStatus: EmailSignalConfirmationStatus;
      if (identity) {
        confirmationStatus = 'AUTO_CREATED';
      } else if (!match.applicationId || !toStatus || combinedConfidence === null) {
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
        // No existing application to point at yet for AUTO_CREATED — the durable link instead
        // lives on the new application's own first application_events row (emailSignalId below).
        matchedApplicationId: identity ? null : match.applicationId,
        classification,
        confidence: identity ? classificationConfidence : combinedConfidence,
        evidence,
        confirmationStatus,
      });

      if (identity) {
        const newApplication = await createAutoTrackedApplicationFromEmail(supabase, userId, {
          company: identity.company,
          title: identity.title,
          appliedAt: metadata.receivedAt,
          emailSignalId: signal.id,
        });
        // `applications` is the one snapshot `matchApplication` reads for every message in this
        // batch — without this push, a second unmatched message for the same company later in
        // the same batch (a duplicate ATS confirmation, a resend, …) would still see "no match"
        // against the stale snapshot and create a second duplicate application for the same job.
        applications.push(newApplication);
        autoCreated += 1;
      } else if (confirmationStatus === 'AUTO_APPLIED' && match.applicationId && toStatus) {
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

  return { status: 'synced', processed, autoApplied, needsConfirmation, skipped, autoCreated, errors };
}
