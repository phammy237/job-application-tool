import type { CompanyResearchSourceType } from '../schemas/company-research';

/**
 * A small, explicit allowlist of well-known reputable independent reporting domains
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §19/§20) — deliberately conservative and short rather
 * than an attempt at a general news-quality classifier. A domain absent from this list is never
 * treated as REPUTABLE_NEWS on that basis alone; it falls through to an OFFICIAL_ category or
 * OTHER based on the other heuristics below.
 */
const REPUTABLE_NEWS_DOMAINS = new Set([
  'reuters.com',
  'bloomberg.com',
  'apnews.com',
  'wsj.com',
  'nytimes.com',
  'ft.com',
  'techcrunch.com',
  'theverge.com',
  'cnbc.com',
  'forbes.com',
  'axios.com',
  'businessinsider.com',
  'wired.com',
  'arstechnica.com',
  // Press-release wire services: third-party distribution, not the company's own domain, but
  // also not independent editorial reporting — grouped here as the closest fit of the fixed
  // source_type enum (§19 "do not add speculative categories with no current use").
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
]);

/**
 * Job-board/ATS domains a job posting might be hosted on — never the *company's own* domain
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §21: "Do not assume the job-posting URL domain is the
 * company domain"). Sources on these domains are excluded from research entirely upstream
 * (`select-company-research-sources.ts`), never persisted — this list exists here too so
 * `classifyCompanyResearchSourceType` never mistakes one for OFFICIAL_WEBSITE/CAREERS even if it
 * were ever called on one directly.
 */
export const JOB_BOARD_DOMAINS = new Set([
  'greenhouse.io',
  'boards.greenhouse.io',
  'lever.co',
  'jobs.lever.co',
  'myworkdayjobs.com',
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
]);

/** Strips a leading `www.` and lowercases — good enough for the domain-equality comparisons this
 * module needs; deliberately not a full public-suffix-list implementation. */
export function extractRegistrableDomain(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

/**
 * Deterministic, deliberately conservative source-type classification (docs/
 * IMPLEMENTATION_PLAN.md "Phase 7G" §19–§21) — NOT a general web-content classifier, a small set
 * of URL-shape heuristics, documented honestly rather than presented as more accurate than it is.
 * `primaryCompanyDomain` (when known — see `determinePrimaryCompanyDomain`) is what lets this
 * function tell "the company's own newsroom/careers/blog page" apart from an unrelated site that
 * merely contains the word "news" in its path; without it, official-vs-independent distinctions
 * that depend on domain match degrade to OTHER rather than guessing.
 *
 * Known limitations, documented rather than hidden:
 * - A domain not in `REPUTABLE_NEWS_DOMAINS` and not equal to `primaryCompanyDomain` always
 *   classifies as OTHER, even if it is a perfectly reputable outlet this list doesn't happen to
 *   include — the safe direction (never over-claim REPUTABLE_NEWS) rather than the complete one.
 * - Investor-relations/engineering-blog/careers detection is path/subdomain-string matching, not
 *   real page understanding — a company that structures its site unconventionally may have pages
 *   this function under-classifies as plain OFFICIAL_WEBSITE.
 */
export function classifyCompanyResearchSourceType(
  url: string,
  primaryCompanyDomain: string | null,
): CompanyResearchSourceType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'OTHER';
  }
  const domain = extractRegistrableDomain(url);
  const path = parsed.pathname.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (domain && REPUTABLE_NEWS_DOMAINS.has(domain)) return 'REPUTABLE_NEWS';
  if (domain && JOB_BOARD_DOMAINS.has(domain)) return 'OTHER';

  const isCompanyDomain =
    domain !== null &&
    primaryCompanyDomain !== null &&
    (domain === primaryCompanyDomain || domain.endsWith(`.${primaryCompanyDomain}`));

  if (host.startsWith('ir.') || host.includes('investor') || path.includes('/investor')) {
    return 'INVESTOR_RELATIONS';
  }
  if (
    isCompanyDomain &&
    (host.startsWith('engineering.') ||
      host.startsWith('eng.') ||
      path.includes('/engineering'))
  ) {
    return 'ENGINEERING_BLOG';
  }
  if (
    isCompanyDomain &&
    (path.includes('/newsroom') || path.includes('/press') || path.includes('/news'))
  ) {
    return 'OFFICIAL_NEWSROOM';
  }
  if (isCompanyDomain && (path.includes('/careers') || path.includes('/jobs'))) {
    return 'CAREERS';
  }
  if (isCompanyDomain && path.includes('/blog')) {
    return 'PRODUCT_BLOG';
  }
  if (isCompanyDomain) {
    return 'OFFICIAL_WEBSITE';
  }
  return 'OTHER';
}

/**
 * Heuristically determines the company's own primary domain from a batch of discovery results
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §21) — the most frequently-occurring domain across all
 * search results, excluding known job-board/ATS and reputable-news domains (a company's own site
 * is expected to appear repeatedly across several different query templates; a syndicated press
 * release or a one-off mention is not). Returns null (never a guess) when no domain repeats at
 * least twice — "we don't know" degrades every classification above to OTHER rather than a wrong
 * guess, which is the safer direction (§21: "do not build brittle company-name→domain guessing").
 */
export function determinePrimaryCompanyDomain(urls: string[]): string | null {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const domain = extractRegistrableDomain(url);
    if (!domain || JOB_BOARD_DOMAINS.has(domain) || REPUTABLE_NEWS_DOMAINS.has(domain))
      continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 1; // require at least 2 occurrences before trusting it.
  for (const [domain, count] of counts) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}
