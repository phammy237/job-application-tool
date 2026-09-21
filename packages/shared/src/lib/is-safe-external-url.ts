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
 * - Rejects `localhost` (also with a trailing dot) and internal-only suffixes (`.localhost`,
 *   `.local`, `.internal`, `.localdomain`, `.home.arpa`), plus every non-public IP literal — see
 *   `isNonPublicIpAddress`. The URL parser already normalizes decimal/hex/octal/short IPv4 forms
 *   (`2130706433`, `0x7f000001`, `127.1`) to dotted-quad before this sees them.
 * - Does not perform DNS resolution itself (no network access from a pure function) — a hostname
 *   that only resolves to a private address at request time is not caught here. Callers that
 *   actually FETCH a URL (`packages/discovery`'s `safe-page-fetch.ts`) resolve the hostname
 *   themselves and check each address with `isNonPublicIpAddress`.
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

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '' || hostname === 'localhost' || INTERNAL_ONLY_SUFFIXES.some((s) => hostname.endsWith(s)))
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
  // to fully decode it, since no legitimate source is ever hosted at a bare numeric hostname.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(hostname)) return false;

  return true;
}

/**
 * True when `address` (an IPv4 dotted-quad or an IPv6 text address, with or without brackets, as
 * returned by a DNS lookup) is loopback, private, link-local, unique-local, unspecified,
 * multicast/reserved, or otherwise not a routable public address. Anything unparseable is treated
 * as non-public (fail closed).
 */
export function isNonPublicIpAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (isIPv4Literal(bare)) return isPrivateOrReservedIPv4(bare);
  if (bare.includes(':')) return isPrivateOrReservedIPv6(bare);
  return true;
}

const INTERNAL_ONLY_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isPrivateOrReservedIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255))
    return true; // malformed — fail closed.
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, includes the cloud metadata address
  if (a === 0) return true; // "this" network / unspecified
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast/reserved/broadcast
  return false;
}

function isPrivateOrReservedIPv6(hostnameWithBrackets: string): boolean {
  const hostname = hostnameWithBrackets.replace(/^\[|\]$/g, '').toLowerCase();
  // `::` (unspecified), `::1` (loopback) and every `::x` form (incl. IPv4-mapped `::ffff:a.b.c.d`)
  // — fail closed rather than decode.
  if (hostname.startsWith('::')) return true;
  const groups = hostname.split(':');
  const first = Number.parseInt(groups[0] ?? '', 16);
  if (Number.isNaN(first)) return true; // unparseable — fail closed
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local (fe80–febf)
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (fc00–fdff)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2002) return true; // 2002::/16 6to4 — embeds an arbitrary IPv4, fail closed
  if (first === 0x0064 && Number.parseInt(groups[1] ?? '', 16) === 0xff9b) return true; // 64:ff9b::/96 NAT64
  if (first === 0x2001 && (groups[1] === '0' || groups[1] === '' || groups[1] === '0000')) return true; // 2001::/32 Teredo
  if (first === 0x2001 && Number.parseInt(groups[1] ?? '', 16) === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}
