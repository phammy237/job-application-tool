import { extractRegistrableDomain } from './classify-company-research-source';

/**
 * D7.1 — job-posting-destination host classification (docs/JOB_DISCOVERY.md "Official posting
 * resolution"). Deliberately separate from `classify-company-research-source.ts`'s
 * `JOB_BOARD_DOMAINS`: that set *excludes* ATS domains from being treated as "the company's own
 * site" for research purposes; this module *accepts* the same ATS domains as legitimate apply
 * destinations — opposite purpose, so a shared set would be wrong for one caller or the other.
 * `extractRegistrableDomain` itself is reused unchanged (imported, not duplicated) — the same
 * precedent `select-company-research-sources.ts` already established.
 *
 * This is the single source of truth for "is this URL a real place to apply" — both the official-
 * posting resolver's confidence validator (`packages/discovery`) and the Discover UI's
 * apply-action selector (`select-job-apply-actions.ts`) import it, so the two can never disagree
 * about which cards show an employer apply link versus a search fallback.
 */
export type JobPostingHostClass =
  | 'EMPLOYER_DOMAIN'
  | 'ACCEPTED_ATS'
  | 'REJECTED_AGGREGATOR'
  | 'UNKNOWN';

/**
 * Employer-authorized ATS BASE domains a URL can be a valid canonical apply destination on, even
 * when Career OS has no ingestion adapter for that ATS at all (docs task §9: "A URL can be a valid
 * canonical application destination without Career OS having a full ingestion adapter for that
 * ATS"). Matched by suffix (`matchesRegistrableSuffix` below), not exact equality — every one of
 * these is routinely used behind a company/board-specific subdomain (`boards.greenhouse.io`,
 * `acme.wd1.myworkdayjobs.com`, `jobs.smartrecruiters.com`, ...), so listing every possible
 * subdomain variant would be both incomplete and a maintenance trap. Includes the three ATSes
 * Career OS already ingests (Greenhouse/Lever/Ashby — their own `canonical_apply_url` already
 * lands here today, so this list also has to keep accepting them) plus the three named in the task
 * spec that Career OS does not yet ingest, plus iCIMS/Taleo — added after real resolver sample
 * verification found both appearing as correct, high-precision candidates repeatedly held at
 * REVIEW purely for being absent from this list (never a matching-logic issue).
 */
const ACCEPTED_ATS_BASE_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'jobvite.com',
  'icims.com',
  'taleo.net',
];

/**
 * Aggregators/discovery-source BASE domains that may be evidence a role exists but are never the
 * preferred apply destination (docs task §2 "Reject as canonical destinations"). `jobright.ai` is
 * here deliberately — Jobright is the discovery source, never the apply destination, which is the
 * entire point of D7.1. Also matched by suffix, for the same reason as above.
 *
 * `bebee.com`/`supportfinity.com`/`prosple.com`/`accaglobal.com` added after a live production
 * resolver run surfaced them as REVIEW-tier candidates that are, in fact, third-party reposts of
 * someone else's posting — never the target employer's own domain, so they'd never pass
 * `matchesEmployerDomain` either, but an explicit reject is more direct than relying solely on
 * that omission, and gives a clearer diagnostic reason. Extending this existing, maintained list
 * — not a new, separate hardcoded set — per this repo's own established mechanism for this kind
 * of domain.
 */
const REJECTED_AGGREGATOR_BASE_DOMAINS = [
  'jobright.ai',
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'simplify.jobs',
  'bebee.com',
  'supportfinity.com',
  'prosple.com',
  'accaglobal.com',
];

/**
 * A genuinely pattern-based rejection, rather than one more hardcoded domain: `.edu` career-
 * services portals repost postings for many unrelated outside employers (a live example:
 * `careerservices.stjohns.edu` carrying a third-party company's job) — there is no useful sense
 * in which any specific university's domain is ever the *target employer's* own apply
 * destination in this product's context (job_catalog employers are companies, not the
 * universities whose career centers happen to list their openings). Generalizing by TLD avoids
 * hardcoding every individual university's domain, the one category here where that's both safe
 * and tractable (unlike "professional job board," which has no comparably safe structural
 * signal and stays a hardcoded, reviewed list above).
 */
function isUniversityCareerPortal(hostname: string): boolean {
  return hostname === 'edu' || hostname.endsWith('.edu');
}

/** Exported so callers that need a host-shape decision *finer* than the four-way classification
 * above (e.g. the validator's per-ATS page-type rules for iCIMS/Taleo) can reuse the exact same
 * dot-boundary suffix check — never a bare `.endsWith(base)`, which would wrongly accept a
 * lookalike like `evil-icims.com` (its own trailing characters literally spell "icims.com" with
 * no dot boundary in front of it). */
export function matchesRegistrableSuffix(domain: string, baseDomains: string[]): boolean {
  return baseDomains.some((base) => domain === base || domain.endsWith(`.${base}`));
}

/**
 * Classifies a URL's host for apply-destination purposes. `employerDomainHint` is an optional,
 * already-confirmed employer domain (never guessed here) — when known, an exact or subdomain
 * match classifies as `EMPLOYER_DOMAIN`. Left `null` in every current caller (Career OS doesn't
 * yet track a confirmed per-company domain) — a documented extension point, not a gap that
 * degrades correctness: without it, an employer's own domain simply classifies `UNKNOWN` rather
 * than `EMPLOYER_DOMAIN`, which the resolver's validator treats as "can reach REVIEW, never HIGH"
 * rather than a wrong accept.
 */
export function classifyJobPostingHost(
  url: string,
  employerDomainHint: string | null = null,
): JobPostingHostClass {
  const domain = extractRegistrableDomain(url);
  if (!domain) return 'UNKNOWN';

  if (matchesRegistrableSuffix(domain, REJECTED_AGGREGATOR_BASE_DOMAINS)) return 'REJECTED_AGGREGATOR';
  if (isUniversityCareerPortal(domain)) return 'REJECTED_AGGREGATOR';
  if (matchesRegistrableSuffix(domain, ACCEPTED_ATS_BASE_DOMAINS)) return 'ACCEPTED_ATS';
  if (employerDomainHint && matchesRegistrableSuffix(domain, [employerDomainHint])) {
    return 'EMPLOYER_DOMAIN';
  }
  return 'UNKNOWN';
}
