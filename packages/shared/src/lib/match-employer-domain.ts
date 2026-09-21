import { extractRegistrableDomain } from './classify-company-research-source';

/**
 * D7.1 hardening — deterministic evidence that a candidate URL's host is plausibly the target
 * company's OWN domain. This never *invents* a URL (CLAUDE.md "never invent a fact"): it only
 * compares two already-known pieces of data — the job's own `companyName` and the hostname of a
 * URL some other process (search) already found — and reports whether they agree. It is
 * deliberately not "guess `companyName.toLowerCase() + '.com'` and trust it" — that would fabricate
 * a URL Career OS never actually observed; this only validates a relationship between two URLs
 * that already exist.
 *
 * Matches on the *exact*, whole root-domain label — never a substring/`.includes()` check — so a
 * short or generic company name can never accidentally match an unrelated domain that merely
 * shares some letters (a hypothetical company "Support" must never match "supportfinity.com":
 * labels "support" vs "supportfinity" are compared for equality, not containment, and are not
 * equal).
 */

const GENERIC_LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'group',
  'holdings',
  'plc',
]);

/** Minimum root-label length considered — guards against a very short/generic slug ("co", "hq")
 * coincidentally equaling an unrelated short domain label. RTX (3 chars) is the shortest real
 * example this needs to admit. */
const MIN_ROOT_LABEL_LENGTH = 3;

function companyNameWords(companyName: string): string[] {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !GENERIC_LEGAL_SUFFIXES.has(word));
}

/**
 * The root label a hostname would need to equal to plausibly be this company's own domain — e.g.
 * "cisco" from "careers.cisco.com" (the first of the last two dot-separated labels). Same
 * documented "not a full public-suffix-list implementation" honesty as `extractRegistrableDomain`
 * itself (`classify-company-research-source.ts`) — this mis-handles a two-part TLD like "co.uk",
 * an accepted limitation shared with the rest of this module, not a new one.
 */
function hostnameRootLabel(hostname: string): string {
  const labels = hostname.split('.');
  const root = labels.length > 2 ? labels.slice(-2) : labels;
  return root[0] ?? '';
}

/**
 * True when `url`'s hostname's root label exactly equals either the company name's full
 * (legal-suffix-stripped) concatenated slug, or its first significant word alone — the latter
 * covers the common case of a multi-word legal name whose brand/domain is just its first word
 * ("Cisco Systems, Inc." -> "cisco.com"). Both real examples this was built against (`RTX` ->
 * `rtx.com`, `Manulife` -> `manulife.com`) match trivially via the single-word case; `Cisco` ->
 * `cisco.com` matches via either rule identically.
 */
export function matchesEmployerDomain(companyName: string, url: string): boolean {
  const domain = extractRegistrableDomain(url);
  if (!domain) return false;

  const words = companyNameWords(companyName);
  if (words.length === 0) return false;

  const rootLabel = hostnameRootLabel(domain);
  if (rootLabel.length < MIN_ROOT_LABEL_LENGTH) return false;

  const concatenatedSlug = words.join('');
  const firstWordSlug = words[0]!;
  return rootLabel === concatenatedSlug || rootLabel === firstWordSlug;
}
