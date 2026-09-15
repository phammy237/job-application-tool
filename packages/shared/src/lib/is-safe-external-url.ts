/**
 * Defensive URL-safety check for any URL that reaches Career OS from an external provider (a
 * search/extraction API's own result metadata) before it is ever passed back to that same
 * provider, persisted, or shown to the user (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §22/§77).
 *
 * Phase 7G deliberately never fetches an arbitrary third-party URL directly from Career OS's own
 * servers — discovery and extraction both go through a provider API Career OS calls with plain
 * HTTPS requests (see `packages/ai/src/research/tavily-client.ts`), which is the §22-preferred
 * design ("If provider-side extraction eliminates the need for arbitrary server fetch: prefer
 * that"). This function is the remaining, narrower defense-in-depth layer: the provider's own
 * response is still untrusted data (§77 — "Search provider metadata is untrusted too"), so every
 * URL it returns is validated before Career OS does anything else with it, including asking the
 * *same* provider to extract it.
 *
 * Deliberately conservative and documented rather than exhaustive:
 * - http/https only — no `javascript:`, `data:`, `file:`, `ftp:`, or any other scheme.
 * - No embedded userinfo (`https://user:pass@host/...`) — a classic SSRF/host-confusion vector.
 * - Rejects `localhost`, loopback (127.0.0.0/8, ::1), RFC1918 private ranges, link-local
 *   (169.254.0.0/16, including the 169.254.169.254 cloud metadata address, and fe80::/10), and a
 *   handful of common IP-literal obfuscation tricks (a bare decimal/octal/hex IPv4 literal like
 *   `2130706433` or `0x7f000001`, both of which resolve to 127.0.0.1).
 * - Does not perform DNS resolution itself (no network access from a pure function) — a hostname
 *   that only resolves to a private address at request time is not caught here; the caller
 *   (`tavily-client.ts`) never resolves or fetches the URL itself, only ever hands it back to the
 *   provider, so this is intentionally a shape check, not a full SSRF-proof network guarantee.
 */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === '' || hostname === 'localhost' || hostname.endsWith('.localhost'))
    return false;

  if (isIPv4Literal(hostname)) {
    return !isPrivateOrReservedIPv4(hostname);
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    // IPv6 literal (URL hostnames for IPv6 keep the brackets from the original authority).
    return !isPrivateOrReservedIPv6(hostname);
  }
  // A bare all-digits/hex hostname (e.g. "2130706433" or "0x7f000001") is a decimal/hex IPv4
  // literal trick browsers and some HTTP clients still accept — reject outright rather than try
  // to fully decode it, since no legitimate research source is ever hosted at a bare numeric
  // hostname.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(hostname)) return false;

  return true;
}

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isPrivateOrReservedIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255))
    return true; // malformed — fail closed.
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, includes the cloud metadata address
  if (a === 0) return true; // "this" network
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrReservedIPv6(hostnameWithBrackets: string): boolean {
  const hostname = hostnameWithBrackets.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === '::1') return true; // loopback
  if (hostname === '::' || hostname.startsWith('::')) return true; // unspecified/mapped — fail closed
  if (hostname.startsWith('fe80:') || hostname.startsWith('fe80::')) return true; // link-local
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true; // unique local (fc00::/7)
  return false;
}
