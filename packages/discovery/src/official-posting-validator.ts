import {
  classifyJobPostingHost,
  extractRegistrableDomain,
  matchesRegistrableSuffix,
  normalizeCompanyNameForDedupe,
  normalizeJobTitle,
  normalizeLocationText,
  type JobPostingHostClass,
} from '@career-os/shared';

/**
 * D7.1 §3-4 — the deterministic confidence scorer/validator for a Strategy-B (search) candidate.
 * No LLM anywhere in this file: every signal is a plain string/host comparison, and "contains a
 * shared word" is never sufficient on its own for the title signal — a real token-overlap RATIO is
 * required (docs task §3: "Do not accept a result merely because its title contains similar
 * words"). Precision is favored over recall throughout: an ambiguous signal degrades the tier, it
 * never gets rounded up.
 */

export interface PostingCandidate {
  url: string;
  title: string;
  content: string;
}

export interface ValidationInput {
  companyName: string;
  title: string;
  locationText: string | null;
}

export type ResolutionTier = 'HIGH' | 'REVIEW' | 'UNRESOLVED';

export interface ValidationResult {
  tier: ResolutionTier;
  /** 0-100, for storage/reporting only — never itself the decision, `tier` is. */
  confidence: number;
  hostClass: JobPostingHostClass;
  /** Human-readable, for the backfill report only — never shown to end users. */
  reasons: string[];
}

const REMOTE_OR_MULTI_LOCATION_PHRASES = [
  'remote',
  'multiple locations',
  'various locations',
  'hybrid',
  'nationwide',
];

function titleTokens(title: string): Set<string> {
  return new Set(normalizeJobTitle(title).split(/[\s,/&-]+/).filter(Boolean));
}

/**
 * Containment ratio (0-1): what fraction of the *expected* (Jobright) title's own word tokens
 * appear in the candidate's title. Deliberately asymmetric, not Jaccard — a real search result's
 * title routinely carries extra boilerplate the expected title never had ("... - Acme Corp",
 * "... | Careers"), and that extra text must never dilute an otherwise-exact match. A single
 * shared word is still never enough on its own (docs task §3) because this is a ratio over the
 * *whole* expected title, not a presence check.
 */
function titleOverlapRatio(expectedTitle: string, candidateTitle: string): number {
  const expected = titleTokens(expectedTitle);
  const candidate = titleTokens(candidateTitle);
  if (expected.size === 0) return 0;
  let intersection = 0;
  for (const token of expected) if (candidate.has(token)) intersection += 1;
  return intersection / expected.size;
}

function companyMatches(expectedCompany: string, candidate: PostingCandidate): boolean {
  const normalizedExpected = normalizeCompanyNameForDedupe(expectedCompany);
  const haystack = `${candidate.title} ${candidate.url} ${candidate.content}`.toLowerCase();
  return normalizedExpected.length > 0 && haystack.includes(normalizedExpected);
}

type LocationSignal = 'COMPATIBLE' | 'REMOTE_OR_UNSPECIFIED' | 'MISMATCH' | 'UNKNOWN';

function evaluateLocation(expectedLocation: string | null, candidate: PostingCandidate): LocationSignal {
  if (!expectedLocation) return 'UNKNOWN';
  const haystack = `${candidate.title} ${candidate.content}`.toLowerCase();
  if (REMOTE_OR_MULTI_LOCATION_PHRASES.some((phrase) => haystack.includes(phrase))) {
    return 'REMOTE_OR_UNSPECIFIED';
  }
  const normalizedExpected = normalizeLocationText(expectedLocation);
  const expectedCityToken = normalizedExpected.split(',')[0]?.trim();
  if (expectedCityToken && haystack.includes(expectedCityToken)) return 'COMPATIBLE';
  // A candidate that names a location at all but not this one is treated as UNKNOWN (not a hard
  // mismatch) unless it clearly reads as a single-location posting for a different place —
  // conservatively only penalized when the candidate's own title contains a location-shaped
  // "City, ST" pattern that differs from the expected one.
  const candidateHasDifferentCityPattern = /,\s*[A-Z]{2}\b/.test(candidate.title) && expectedCityToken
    ? !candidate.title.toLowerCase().includes(expectedCityToken)
    : false;
  return candidateHasDifferentCityPattern ? 'MISMATCH' : 'UNKNOWN';
}

const ICIMS_BASE_DOMAIN = ['icims.com'];
const TALEO_BASE_DOMAIN = ['taleo.net'];

/** Individual-posting-shaped path (a slug or a numeric/hash id segment) vs. a bare homepage/
 * careers-index path with nothing further. Documented heuristic, not a guarantee — same honesty
 * precedent as classify-company-research-source.ts's own doc comments.
 *
 * iCIMS and Taleo get their own, stricter rules rather than falling through to the generic
 * slug/segment-count heuristic: both platforms' generic home/login/search pages (e.g. iCIMS
 * `.../jobs/search`, `.../jobs/intro`; Taleo `.../moresearch.ftl`, `.../joblist.ftl`) have
 * multi-segment, dash-free paths that the generic heuristic's `segments.length >= 2` fallback
 * would otherwise wrongly accept as an individual posting. */
function looksLikeIndividualPosting(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const domain = extractRegistrableDomain(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase() ?? '';

  if (domain && matchesRegistrableSuffix(domain, ICIMS_BASE_DOMAIN)) {
    // A real iCIMS posting path always ends in a literal "job" segment
    // (".../jobs/<id>/<slug>/job"); every generic iCIMS page (home, login, search, "intro") does
    // not.
    return segments.length >= 2 && last === 'job';
  }
  if (domain && matchesRegistrableSuffix(domain, TALEO_BASE_DOMAIN)) {
    // A real Taleo posting is always the literal "jobdetail.ftl" filename carrying a "job="
    // query parameter; search/list/login pages use a different filename entirely
    // (moresearch.ftl, joblist.ftl, careersection home, ...).
    return last === 'jobdetail.ftl' && parsed.searchParams.has('job');
  }

  if (segments.length === 0) return false;
  // A final segment that's just "careers"/"jobs"/"job"/"openings" with nothing after it reads as
  // an index page, not one specific posting.
  if (/^(careers|jobs|job|openings)$/i.test(last) && segments.length <= 1) return false;
  // A slug with multiple words (dashes) or a long alphanumeric/hash id reads as one real posting.
  return /-/.test(last) || /[0-9a-f]{5,}/i.test(last) || segments.length >= 2;
}

const HIGH_TITLE_OVERLAP = 0.85;
const REVIEW_TITLE_OVERLAP = 0.7;

export function validateOfficialPostingCandidate(
  input: ValidationInput,
  candidate: PostingCandidate,
): ValidationResult {
  const reasons: string[] = [];
  const hostClass = classifyJobPostingHost(candidate.url);

  if (hostClass === 'REJECTED_AGGREGATOR') {
    return {
      tier: 'UNRESOLVED',
      confidence: 0,
      hostClass,
      reasons: ['rejected: host is a known aggregator/discovery site, never a canonical destination'],
    };
  }

  const companyOk = companyMatches(input.companyName, candidate);
  if (!companyOk) reasons.push('company name not found in candidate title/url/content');
  else reasons.push('company name confirmed');

  const overlap = titleOverlapRatio(input.title, candidate.title);
  reasons.push(`title token-overlap ratio: ${overlap.toFixed(2)}`);

  const locationSignal = evaluateLocation(input.locationText, candidate);
  reasons.push(`location signal: ${locationSignal}`);

  const pageTypeOk = looksLikeIndividualPosting(candidate.url);
  if (!pageTypeOk) reasons.push('url does not look like an individual job-detail page');

  if (!companyOk || overlap < REVIEW_TITLE_OVERLAP || locationSignal === 'MISMATCH') {
    return { tier: 'UNRESOLVED', confidence: Math.round(overlap * 40), hostClass, reasons };
  }

  const domainAcceptable = hostClass === 'EMPLOYER_DOMAIN' || hostClass === 'ACCEPTED_ATS';
  const strongTitle = overlap >= HIGH_TITLE_OVERLAP;
  // MISMATCH already exited above — anything reaching here is COMPATIBLE/REMOTE_OR_UNSPECIFIED/
  // UNKNOWN, and UNKNOWN (no location signal either side, or genuinely ambiguous) is neutral,
  // never a blocker, the same "unknown is never equivalent to a mismatch" principle used
  // throughout D4/D7 — so location is never what excludes HIGH at this point.

  if (domainAcceptable && strongTitle && pageTypeOk) {
    reasons.push('all HIGH-tier signals satisfied (host/company/title/location/page-type)');
    return { tier: 'HIGH', confidence: 90, hostClass, reasons };
  }

  // REVIEW: company confirmed and title at least moderately overlapping, but missing one other
  // signal (unknown host, weaker title, ambiguous location, or homepage-shaped url).
  reasons.push('company and moderate title match, but one or more HIGH-tier signals missing');
  const reviewConfidence = Math.round(50 + overlap * 30);
  return { tier: 'REVIEW', confidence: Math.min(reviewConfidence, 79), hostClass, reasons };
}
