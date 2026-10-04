/**
 * Returns the normalised URL only when it is a well-formed http(s) URL; otherwise null.
 * Stored URLs (evidence source_url, repo html_url, project url) are user/third-party controlled,
 * so anything rendered as an href must pass through this (blocks javascript:, data:, vbscript:).
 */
export function safeHttpHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
