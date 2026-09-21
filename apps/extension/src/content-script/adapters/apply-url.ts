/**
 * Finds the direct official application destination for a job posting — distinct from the page
 * URL itself (see docs/DATA_MODEL.md "jobs" apply_url). Absent (null) rather than guessed when
 * nothing reliable is found; a wrong/irrelevant applyUrl is worse than none, since the popup
 * would offer it as an "Open Application" action (docs/EXTENSION_DESIGN.md, Apply URL UX).
 *
 * Priority order (docs/PRODUCT_SPEC.md's "Apply URL" gap):
 *   1. JobPosting JSON-LD's own `url`, only when it resolves to a distinct, plausible apply
 *      destination — schema.org has no dedicated "apply URL" property, so this is a heuristic,
 *      not a guaranteed-correct read of a standard field.
 *   2. The first on-page control (anchor, or button/[role=button] carrying a real href-like
 *      attribute) whose *entire* visible text is an apply-shaped phrase ("Apply", "Apply now",
 *      "Apply for this role", "Start application", …) — never a substring match, so a paragraph
 *      that merely mentions "apply" is never treated as a control.
 *
 * Excluded unconditionally: controls inside <nav>/<header>/<footer> (site chrome, not the job's
 * own apply action), non-http(s) targets, Google hosts (e.g. a "search on Google" link), and
 * destinations that look like a generic careers/search listing rather than a specific posting
 * (bare "/careers", "/jobs", "/search", or any URL carrying a search-query parameter).
 */

const APPLY_TEXT_PATTERN =
  /^(apply(\s+now)?|apply\s+for\s+this\s+(role|job|position)|start\s+(your\s+)?application|submit\s+(your\s+)?application)$/i;

const EXCLUDED_HOSTNAME_SUBSTRINGS = ['google.'];

const GENERIC_LISTING_PATHS = new Set(['', '/careers', '/jobs', '/careers/search', '/jobs/search', '/search']);

function resolveAbsoluteUrl(href: string, base: string): URL | null {
  try {
    const resolved = new URL(href, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : null;
  } catch {
    return null;
  }
}

function isExcludedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return EXCLUDED_HOSTNAME_SUBSTRINGS.some((substring) => host.includes(substring));
}

function isGenericListingUrl(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  if (GENERIC_LISTING_PATHS.has(path)) return true;
  return url.searchParams.has('q') || url.searchParams.has('query');
}

/** True only when a candidate URL is worth trusting as a real, specific apply destination. */
function isPlausibleApplyDestination(url: URL): boolean {
  return !isExcludedHost(url.hostname) && !isGenericListingUrl(url);
}

function findApplyControlHrefs(document: Document): string[] {
  const hrefs: string[] = [];
  const controls = document.querySelectorAll('a[href], button, [role="button"]');
  for (const control of controls) {
    if (control.closest('nav, header, footer')) continue;

    const text = control.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!APPLY_TEXT_PATTERN.test(text)) continue;

    const href =
      control.getAttribute('href') ??
      control.getAttribute('formaction') ??
      control.getAttribute('data-href') ??
      control.getAttribute('data-url');
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/**
 * `jsonLdUrl` is the JobPosting JSON-LD's own `url` field, if present — passed in rather than
 * re-parsed here since GenericHtmlAdapter already extracted the JSON-LD object once.
 */
export function extractApplyUrl(
  document: Document,
  pageUrl: string,
  sourceUrl: string | null,
  jsonLdUrl: string | undefined,
): string | null {
  if (jsonLdUrl) {
    const resolved = resolveAbsoluteUrl(jsonLdUrl, pageUrl);
    if (resolved && resolved.href !== sourceUrl && isPlausibleApplyDestination(resolved)) {
      return resolved.href;
    }
  }

  for (const controlHref of findApplyControlHrefs(document)) {
    const resolved = resolveAbsoluteUrl(controlHref, pageUrl);
    if (resolved && isPlausibleApplyDestination(resolved)) {
      return resolved.href;
    }
  }

  return null;
}
