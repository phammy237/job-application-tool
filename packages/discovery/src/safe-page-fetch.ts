import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isNonPublicIpAddress, isSafeExternalUrl } from '@career-os/shared';
import { errorMessage } from './adapters/util';

/**
 * The only way the resolver fetches a candidate/canonical page. Replaces `redirect: 'follow'` with
 * bounded MANUAL redirects so every hop is validated BEFORE it is requested:
 *   - at most `MAX_REDIRECTS` redirects; a further one is refused;
 *   - every destination (the initial URL and each `Location`, resolved against the previous URL) must
 *     pass `isSafeExternalUrl` (http/https only, no userinfo, no localhost / private / link-local /
 *     loopback / unspecified / metadata addresses);
 *   - the hostname is resolved via DNS before each hop and the hop is refused if ANY resolved address
 *     is non-public (`isNonPublicIpAddress`);
 *   - only a `User-Agent` header is ever sent, so nothing sensitive can leak across a cross-host hop;
 *   - one `AbortSignal.timeout` covers the whole chain (and stays attached to the returned response,
 *     so the caller's body read is bounded by it too).
 *
 * KNOWN LIMITATION (DNS rebinding / TOCTOU): the address check resolves the hostname separately from
 * the connection `fetch` then makes, and the global `fetch` gives no hook to pin the connection to
 * the address we validated. A hostile DNS server that answers differently to the second lookup can
 * therefore still steer that one request to a private address. Fully closing it needs a connection-
 * level guard (an `undici` dispatcher with a validating `connect.lookup`, or `http(s).request` with a
 * custom `lookup`) — not done here. What this DOES prevent: literal/obfuscated private IPs, names
 * that (consistently) resolve to private space, and redirects into any of them.
 */

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type HostnameResolver = (hostname: string) => Promise<string[]>;

const systemResolver: HostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export type SafeFetchResult =
  | { kind: 'response'; response: Response; finalUrl: string; redirects: number }
  | { kind: 'blocked'; reason: string; url: string }
  | { kind: 'failed'; reason: string };

export interface SafeFetchOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  method?: 'GET' | 'HEAD';
  maxRedirects?: number;
  /** Injectable for tests; defaults to the system resolver (`dns.lookup`, all addresses). */
  resolveHost?: HostnameResolver;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Returns a block reason when `url`'s host is not a public destination, otherwise null. */
async function blockReason(url: string, resolveHost: HostnameResolver, signal: AbortSignal): Promise<string | null> {
  if (!isSafeExternalUrl(url)) return 'url is not a safe public http(s) destination';
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(hostname)) return null; // literal already vetted (public) by isSafeExternalUrl
  let addresses: string[];
  try {
    addresses = await abortable(resolveHost(hostname), signal);
  } catch (error) {
    return `dns lookup failed: ${errorMessage(error)}`;
  }
  if (addresses.length === 0) return 'dns lookup returned no addresses';
  const bad = addresses.find(isNonPublicIpAddress);
  return bad ? `host resolves to a non-public address (${bad})` : null;
}

/** undici reports nearly every connection failure as a bare "fetch failed"; the useful part
 * (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT, ...) is on `error.cause`. */
function describeNetworkError(error: unknown): string {
  const message = errorMessage(error);
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? `${message} (${cause.code})` : message;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // nothing to release
  }
}

export async function fetchWithSafeRedirects(url: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const resolveHost = options.resolveHost ?? systemResolver;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const signal = AbortSignal.timeout(options.timeoutMs);

  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    const blocked = await blockReason(current, resolveHost, signal).catch((error) => `check failed: ${errorMessage(error)}`);
    if (blocked) return { kind: 'blocked', reason: blocked, url: current };

    let response: Response;
    try {
      response = await fetch(current, {
        method: options.method ?? 'GET',
        headers: options.headers,
        signal,
        redirect: 'manual',
      });
    } catch (error) {
      return { kind: 'failed', reason: `network error: ${describeNetworkError(error)}` };
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { kind: 'response', response, finalUrl: current, redirects };
    }

    await discard(response);
    if (redirects >= maxRedirects) {
      return { kind: 'failed', reason: `too many redirects (more than ${maxRedirects})` };
    }
    const location = response.headers?.get('location');
    if (!location) return { kind: 'failed', reason: `HTTP ${response.status} redirect without a Location header` };
    try {
      current = new URL(location, current).toString();
    } catch {
      return { kind: 'failed', reason: 'malformed redirect Location header' };
    }
  }
}
