import { EMAIL_SNIPPET_CHAR_CAP } from '../config';

export interface BuildEmailClassificationUserPromptParams {
  sender: string;
  subject: string;
  snippet: string;
  /** Set on the retry attempt — see generate-email-classification.ts's retry-once step. */
  retryReason?: string;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

export function buildEmailClassificationUserPrompt(
  params: BuildEmailClassificationUserPromptParams,
): string {
  const { sender, subject, snippet, retryReason } = params;

  const emailSection = [
    `From: ${sender}`,
    `Subject: ${subject}`,
    `Snippet: ${truncate(snippet, EMAIL_SNIPPET_CHAR_CAP)}`,
  ].join('\n');

  const parts = [`<email_message>\n${emailSection}\n</email_message>`];

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Respond with a single JSON object ` +
        `matching the required shape exactly — no wrapping array, no extra fields. Try again.`,
    );
  }

  return parts.join('\n\n');
}
