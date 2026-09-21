/**
 * The only place Workday-specific page knowledge lives. Generic resolver logic consumes just the
 * neutral `postingAvailable: boolean | null` these helpers feed into `extractPageJobIdentity` and
 * the URL they return — it never mentions Workday.
 */

const WORKDAY_HOST_SUFFIX = 'myworkdayjobs.com';

// A Workday job page is a client-rendered shell served with HTTP 200 even for a closed
// requisition; the only server-side signal is this literal in the inline `window.workday`
// bootstrap object.
const POSTING_AVAILABLE_PATTERN = /postingAvailable\s*:\s*(true|false)/;

/** Workday's own `postingAvailable` flag: false = closed, true = live, null = not a Workday shell. */
export function readWorkdayPostingAvailability(html: string): boolean | null {
  if (!html.includes('window.workday')) return null;
  const match = POSTING_AVAILABLE_PATTERN.exec(html);
  return match ? match[1] === 'true' : null;
}

/**
 * Maps a Workday apply-step URL (`.../job/<location>/<slug>_R123/apply`) to its job-detail page by
 * dropping the trailing `/apply` segment, so identity is read from the detail page instead. The
 * `/apply` shell reports `postingAvailable: false` even for a live requisition (verified against a
 * live posting), so it can't be used for either identity or liveness. Pure string transform:
 * it swaps which URL gets fetched, it never adds a request. Any other URL is returned unchanged.
 */
export function normalizeWorkdayApplyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== WORKDAY_HOST_SUFFIX && !host.endsWith(`.${WORKDAY_HOST_SUFFIX}`)) return url;
  const detailPath = /^(.*\/job\/.+?)\/apply(?:\/.*)?$/i.exec(parsed.pathname)?.[1];
  if (!detailPath) return url;
  parsed.pathname = detailPath;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
