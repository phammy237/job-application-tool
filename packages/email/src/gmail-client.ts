import { GMAIL_API_BASE_URL } from './config';

export interface SearchedMessage {
  id: string;
}

export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults: number,
): Promise<SearchedMessage[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const response = await fetch(`${GMAIL_API_BASE_URL}/users/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail messages.list failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { messages?: Array<{ id: string }> };
  return (body.messages ?? []).map((m) => ({ id: m.id }));
}

export interface MessageMetadata {
  id: string;
  sender: string | null;
  senderDomain: string | null;
  subject: string | null;
  snippet: string;
  receivedAt: string | null;
}

function extractDomain(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = /@([^\s>]+)/.exec(fromHeader);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * `format=metadata` with an explicit header allowlist — never fetches the full raw MIME body
 * (docs/EMAIL_INTEGRATION.md §3's data-minimization rule). No write methods exist in this file
 * at all — enforced by simply never implementing one.
 */
export async function getMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<MessageMetadata> {
  const params = new URLSearchParams({ format: 'metadata' });
  params.append('metadataHeaders', 'From');
  params.append('metadataHeaders', 'Subject');
  params.append('metadataHeaders', 'Date');

  const response = await fetch(
    `${GMAIL_API_BASE_URL}/users/me/messages/${messageId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Gmail messages.get failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    id: string;
    snippet?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name: string; value: string }> };
  };

  const headers = body.payload?.headers ?? [];
  const findHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const sender = findHeader('From');
  const subject = findHeader('Subject');
  const dateHeader = findHeader('Date');

  return {
    id: body.id,
    sender,
    senderDomain: extractDomain(sender),
    subject,
    snippet: body.snippet ?? '',
    receivedAt: body.internalDate
      ? new Date(Number(body.internalDate)).toISOString()
      : dateHeader
        ? new Date(dateHeader).toISOString()
        : null,
  };
}
