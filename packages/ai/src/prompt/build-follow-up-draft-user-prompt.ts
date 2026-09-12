import type {
  Application,
  EmailSignal,
  JobSnapshot,
  NextAction,
} from '@career-os/shared';
import { SNAPSHOT_DESCRIPTION_CHAR_CAP } from '../config';

export interface BuildFollowUpDraftUserPromptParams {
  application: Pick<Application, 'company' | 'title' | 'status' | 'appliedAt'>;
  nextAction: Pick<NextAction, 'followUpAnchorAt' | 'daysSinceFollowUpAnchor'>;
  jobSnapshot: JobSnapshot | null;
  /** The most recent CONFIRMED/AUTO_APPLIED email signal for this application, if any — never a
   * PENDING/DECLINED one (see generate-follow-up-draft.ts's own retrieval step for why). Only
   * sender/subject/classification/receivedAt are ever placed here — never the email body, which
   * this codebase never stores at all (docs/EMAIL_INTEGRATION.md §3). */
  confirmedEmailSignal: Pick<
    EmailSignal,
    'sender' | 'subject' | 'classification' | 'receivedAt'
  > | null;
  candidateName: string | null;
  /** Set on the retry attempt — see generate-follow-up-draft.ts's retry-once step. */
  retryReason?: string;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Builds the <application_context> section — the one section that is entirely server-authored,
 * never third-party content, and therefore the only section NOT wrapped in the same "treat as
 * data" warning the other two sections get (there's nothing here for an attacker to have written).
 * Every value here already appears in the trusted `applications` row or the deterministic
 * next-action engine's own output — never a value fetched fresh and unvalidated for this prompt.
 */
function buildApplicationContextSection(
  application: BuildFollowUpDraftUserPromptParams['application'],
  nextAction: BuildFollowUpDraftUserPromptParams['nextAction'],
  candidateName: string | null,
): string {
  const lines = [
    `Company: ${application.company}`,
    `Role: ${application.title}`,
    `Current tracked status: ${application.status}`,
    application.appliedAt ? `Applied on: ${formatDate(application.appliedAt)}` : null,
    nextAction.daysSinceFollowUpAnchor !== null
      ? `Days since the most recent tracked update: ${nextAction.daysSinceFollowUpAnchor}`
      : null,
    candidateName
      ? `Candidate name (sign off with this if provided): ${candidateName}`
      : null,
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

export function buildFollowUpDraftUserPrompt(
  params: BuildFollowUpDraftUserPromptParams,
): string {
  const {
    application,
    nextAction,
    jobSnapshot,
    confirmedEmailSignal,
    candidateName,
    retryReason,
  } = params;

  const parts = [
    `<application_context>\n${buildApplicationContextSection(application, nextAction, candidateName)}\n</application_context>`,
  ];

  if (jobSnapshot) {
    const snapshotLines = [
      `Title: ${jobSnapshot.title}`,
      `Company: ${jobSnapshot.company}`,
      jobSnapshot.description
        ? `Description: ${truncate(jobSnapshot.description, SNAPSHOT_DESCRIPTION_CHAR_CAP)}`
        : null,
    ].filter((line): line is string => line !== null);
    parts.push(`<job_snapshot>\n${snapshotLines.join('\n')}\n</job_snapshot>`);
  }

  if (confirmedEmailSignal) {
    const emailLines = [
      confirmedEmailSignal.sender ? `From: ${confirmedEmailSignal.sender}` : null,
      confirmedEmailSignal.subject ? `Subject: ${confirmedEmailSignal.subject}` : null,
      confirmedEmailSignal.classification
        ? `Career OS classified this as: ${confirmedEmailSignal.classification}`
        : null,
      confirmedEmailSignal.receivedAt
        ? `Received: ${formatDate(confirmedEmailSignal.receivedAt)}`
        : null,
    ].filter((line): line is string => line !== null);
    parts.push(
      `<confirmed_employer_email>\n${emailLines.join('\n')}\n</confirmed_employer_email>`,
    );
  }

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Respond with only the required JSON ` +
        `object, and do not state or imply any interaction, referral, interview, or assessment ` +
        `that was not literally given to you above. Try again.`,
    );
  }

  return parts.join('\n\n');
}
