const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * Normalizes a job-posting URL for duplicate-application matching (docs/IMPLEMENTATION_PLAN.md
 * Phase 4C, tier 2). Strips the query string and fragment entirely — tracking/referral
 * parameters (utm_*, gh_src, etc.) are extremely common on job postings and differ per visit
 * even for the identical listing, so keeping them would create a "duplicate" application almost
 * every time the same posting is reopened from a different link. This does mean two genuinely
 * different postings that differ *only* by query string (e.g. a real requisition id passed as
 * `?req=123` vs `?req=456` on an otherwise identical path) would incorrectly canonicalize to the
 * same value — that's exactly why requisition-ID matching (tier 1) takes precedence over this
 * function's output whenever one is available, rather than this being the sole signal.
 *
 * Also lowercases the host, drops a default port, and removes exactly one trailing slash (but
 * never collapses a bare `/` path to empty). Returns null for anything that doesn't parse as a
 * URL, rather than throwing — a malformed/missing source URL should degrade to no canonical
 * match, not fail the caller.
 */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const port = parsed.port && parsed.port !== DEFAULT_PORTS[parsed.protocol] ? `:${parsed.port}` : '';

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${path}`;
}
