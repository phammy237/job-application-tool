import { tavilySearch } from '@career-os/ai';
import {
  listActiveJobCatalogEntriesForDedupe,
  listAllJobSources,
  listOfficialPostingResolutionCandidates,
  mergeJobCatalogRowIntoAtsMatch,
  recordOfficialPostingResolutionAttempt,
  type CareerOsSupabaseClient,
  type OfficialPostingResolutionCandidate,
} from '@career-os/database';
import {
  classifyJobPostingHost,
  normalizeCompanyNameForDedupe,
  type CrossSourceObservation,
  type JobPostingHostClass,
} from '@career-os/shared';
import { extractPageJobIdentity, type PageJobIdentity } from './candidate-page-identity';
import {
  buildCrossSourceDedupeIndex,
  findCrossSourceDuplicate,
  type CrossSourceDedupeIndex,
} from './dedupe/cross-source-dedupe';
import {
  HIGH_TITLE_OVERLAP,
  titleOverlapRatio,
  titlesMateriallyConflict,
  validateOfficialPostingCandidate,
} from './official-posting-validator';
import { fetchWithSafeRedirects } from './safe-page-fetch';
import { normalizeWorkdayApplyUrl } from './workday-posting-signals';

/**
 * D7.1 — the Official Posting Resolver (docs/JOB_DISCOVERY.md "Official posting resolution").
 * Strategy A (catalog match) is 100% reuse of D7's own `cross-source-dedupe.ts` — no new matching
 * logic. Strategy B (search) is the project's existing Tavily search capability
 * (`@career-os/ai`), validated by the deterministic, LLM-free scorer in
 * `official-posting-validator.ts`. Neither strategy ever reads a user/profile/résumé/application
 * table — the only inputs are `job_catalog` company/title/location (docs task §12).
 */

const SEARCH_MAX_RESULTS = 5;
const LIVENESS_TIMEOUT_MS = 10_000;
const USER_AGENT = 'career-os-job-discovery/1.0 (+https://apply.mypham.space)';

export interface ResolutionOutcome {
  jobCatalogId: string;
  outcome: 'MERGED_INTO_ATS' | 'RESOLVED_HIGH_CONFIDENCE' | 'RESOLVED_REVIEW' | 'UNRESOLVED';
  detail: string;
}

/**
 * Strategy A: does this Jobright candidate already match an ACTIVE ATS-native catalog row? Pure
 * reuse of `findCrossSourceDuplicate` — no new matching logic, no confidence scoring (the
 * cross-source-dedupe module's own conservative evidence order is already the precision bar).
 * Returns the matching row, or null if genuinely no match exists yet.
 */
export function resolveViaCatalogMatch(
  dedupeIndex: CrossSourceDedupeIndex,
  candidate: {
    companyName: string;
    title: string;
    locationText: string | null;
    postedAt: string | null;
  },
) {
  return findCrossSourceDuplicate(dedupeIndex, { ...candidate, canonicalApplyUrl: null });
}

/**
 * Merges a Jobright job_catalog row into an already-matching ATS-native row: appends the
 * cross-source observation, deletes the Jobright row's own match scores, and marks it MERGED (see
 * `mergeJobCatalogRowIntoAtsMatch`'s own doc comment for why all three steps are required). Shared
 * by both the bounded resolver script and `sync-source.ts`'s ongoing per-sync check, so "a
 * Jobright seed that later resolves to an ATS duplicate" is handled identically whichever path
 * discovers it.
 */
export async function mergeIntoAtsMatch(
  supabase: CareerOsSupabaseClient,
  params: {
    jobrightJobCatalogId: string;
    atsJobCatalogId: string;
    sourceIdentifier: string;
    sourceJobId: string;
    sourceUrl: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  const observation: CrossSourceObservation = {
    provider: 'JOBRIGHT_GITHUB',
    sourceIdentifier: params.sourceIdentifier,
    sourceJobId: params.sourceJobId,
    sourceUrl: params.sourceUrl,
    observedAt: now.toISOString(),
  };
  await mergeJobCatalogRowIntoAtsMatch(
    supabase,
    { jobrightJobCatalogId: params.jobrightJobCatalogId, atsJobCatalogId: params.atsJobCatalogId, observation },
    now,
  );
}

function buildSearchQuery(companyName: string, title: string): string {
  return `"${companyName}" "${title}"`;
}

/** Bounded liveness check — HEAD first (falling back to GET on a 405/501, the same pattern real
 * ATS/CDN hosts occasionally require), never treats a network error as anything but "unreachable
 * right now." Redirects are followed only through `fetchWithSafeRedirects` (bounded, every hop
 * validated). Never used to decide REVIEW; only gates HIGH (docs task §3 "STATUS"). */
async function isUrlReachable(url: string): Promise<boolean> {
  const check = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
    const result = await fetchWithSafeRedirects(url, {
      method,
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: LIVENESS_TIMEOUT_MS,
    });
    return result.kind === 'response' ? result.response : null;
  };
  try {
    const head = await check('HEAD');
    if (!head) return false;
    if (head.status === 405 || head.status === 501) {
      const get = await check('GET');
      if (!get) return false;
      await get.body?.cancel?.();
      return get.ok;
    }
    return head.ok;
  } catch {
    return false;
  }
}

export type SearchResolutionOutcome =
  | { tier: 'RESOLVED_HIGH_CONFIDENCE'; url: string; confidence: number }
  | { tier: 'RESOLVED_REVIEW'; url: string; confidence: number }
  | { tier: 'UNRESOLVED'; confidence: number };

const CONTENT_VERIFICATION_TIMEOUT_MS = 10_000;
/** Hard cap on bytes read from any candidate page (identity metadata lives in <head>, and a
 * live Workday/ATS page is well under this). Reading stops at the cap; the truncated text is still
 * parsed, so an oversized page can neither exhaust memory nor break identity extraction. */
const MAX_PAGE_BODY_BYTES = 2_000_000;
/** Confidence recorded for a candidate promoted via page-content verification rather than
 * search-snippet signals alone — distinct from the flat 90 `validateOfficialPostingCandidate`
 * assigns every structural HIGH, purely for diagnostic/reporting clarity (never itself a decision
 * input; both paths are equally "HIGH" as far as any caller is concerned). */
const CONTENT_VERIFIED_CONFIDENCE = 95;

interface ContentVerificationResult {
  verified: boolean;
  reason: string;
}

type FetchedCandidatePage =
  | { kind: 'unreachable'; reason: string }
  | { kind: 'page'; identity: PageJobIdentity; finalUrl: string };

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, MAX_PAGE_BODY_BYTES);
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= MAX_PAGE_BODY_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return text;
}

/** The single bounded page fetch shared by promotion verification and final HIGH confirmation:
 * bounded manual redirects with every hop validated (see `safe-page-fetch.ts`), the shared timeout,
 * http/https only, and the body capped at `MAX_PAGE_BODY_BYTES`. A Workday `/apply` URL is swapped
 * for its detail-page URL (same one request). `finalUrl` is where the redirect chain ended (host
 * changes are reported by revalidation) and drives no decision. Never throws. */
async function fetchCandidatePage(url: string, companyName: string): Promise<FetchedCandidatePage> {
  const fetched = await fetchWithSafeRedirects(normalizeWorkdayApplyUrl(url), {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: CONTENT_VERIFICATION_TIMEOUT_MS,
  });
  if (fetched.kind === 'blocked') return { kind: 'unreachable', reason: `blocked: ${fetched.reason}` };
  if (fetched.kind === 'failed') return { kind: 'unreachable', reason: fetched.reason };
  const { response, finalUrl } = fetched;
  if (!response.ok) return { kind: 'unreachable', reason: `HTTP ${response.status}` };

  let html = '';
  try {
    html = await readBoundedText(response);
  } catch {
    // An unreadable body is "no identity exposed", never a crash.
  }
  return { kind: 'page', identity: extractPageJobIdentity(html, { companyName }), finalUrl };
}

function hiringOrganizationMatches(expectedCompany: string, hiringOrgName: string): boolean {
  const normalizedExpected = normalizeCompanyNameForDedupe(expectedCompany);
  const normalizedActual = normalizeCompanyNameForDedupe(hiringOrgName);
  return (
    normalizedExpected.length > 0 &&
    (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual))
  );
}

export type HighConfirmationOutcome =
  | 'CONFIRMED'
  | 'IDENTITY_UNAVAILABLE'
  | 'MISMATCH'
  | 'CLOSED'
  | 'UNREACHABLE';
export type HighDecision = 'HIGH' | 'REVIEW' | 'DROP';

/**
 * The one decision matrix for a structurally-HIGH candidate after its page was checked. An accepted
 * ATS proves the platform is legitimate, not that this requisition is the expected job, so it needs
 * the page to positively confirm identity; an employer-owned domain keeps its existing behavior when
 * the page simply exposes no identity. A conflicting identity vetoes both; closed/unreachable demote
 * both. Nothing here can promote.
 */
export function decideHighFromConfirmation(
  outcome: HighConfirmationOutcome,
  hostClass: JobPostingHostClass,
): HighDecision {
  switch (outcome) {
    case 'CONFIRMED':
      return 'HIGH';
    case 'MISMATCH':
      return 'DROP';
    case 'CLOSED':
    case 'UNREACHABLE':
      return 'REVIEW';
    case 'IDENTITY_UNAVAILABLE':
      return hostClass === 'ACCEPTED_ATS' ? 'REVIEW' : 'HIGH';
  }
}

export interface HighConfirmation {
  outcome: HighConfirmationOutcome;
  reason: string;
  hostClass: JobPostingHostClass;
  /** Where the fetch ended up after redirects (diagnostic only); null when nothing was fetched. */
  finalUrl: string | null;
}

/**
 * Final identity check for a candidate that is already structurally HIGH from search-snippet
 * evidence, run before HIGH is persisted (one fetch, which also serves as the liveness check). The
 * snippet title is the only title the validator ever scores, so on its own it can't catch "right
 * employer, official ATS, wrong requisition". Identity comes from `extractPageJobIdentity`
 * (JSON-LD → og:title → HTML title; generic titles never count). A closed page, a non-matching
 * `hiringOrganization.name`, or a materially conflicting title is reported as such; a page exposing
 * none of these is `IDENTITY_UNAVAILABLE` and `decideHighFromConfirmation` decides by host class.
 */
export async function confirmHighCandidatePage(
  url: string,
  expected: { companyName: string; title: string },
): Promise<HighConfirmation> {
  const hostClass = classifyJobPostingHost(url);
  const page = await fetchCandidatePage(url, expected.companyName);
  if (page.kind === 'unreachable') {
    return { outcome: 'UNREACHABLE', reason: page.reason, hostClass, finalUrl: null };
  }
  const { identity, finalUrl } = page;
  const result = (outcome: HighConfirmationOutcome, reason: string): HighConfirmation => ({
    outcome,
    reason,
    hostClass,
    finalUrl,
  });

  if (identity.postingAvailable === false) {
    return result('CLOSED', 'candidate page reports the posting is no longer available');
  }
  if (identity.employer && !hiringOrganizationMatches(expected.companyName, identity.employer)) {
    return result(
      'MISMATCH',
      `candidate page hiringOrganization.name "${identity.employer}" does not match expected company "${expected.companyName}"`,
    );
  }
  if (!identity.title) {
    return result('IDENTITY_UNAVAILABLE', 'candidate page exposes no usable job title');
  }
  if (titlesMateriallyConflict(expected.title, identity.title)) {
    return result(
      'MISMATCH',
      `candidate page ${identity.titleSource} title "${identity.title}" materially conflicts with expected title "${expected.title}"`,
    );
  }
  return result('CONFIRMED', `candidate page ${identity.titleSource} title agrees with the expected title`);
}

/**
 * D7.1 hardening §3 — bounded verification fetch for a single, already-promising candidate (an
 * employer-domain-matched REVIEW result that didn't otherwise clear the HIGH bar on search-
 * snippet evidence alone). Fetches only the candidate job-detail URL a search already surfaced —
 * never the company's homepage/careers index, never a crawl of more than this one page — and
 * reads identity through the shared `extractPageJobIdentity` (docs task §4: "do not build a second
 * parser"). Promotion is positive-only: the page must expose BOTH a matching employer
 * (`hiringOrganization.name`) and a title clearing the HIGH bar. Never throws — any failure
 * reports `verified: false` and the caller falls back to whatever it already had (REVIEW or
 * UNRESOLVED), never a crash and never a guess.
 */
export async function verifyCandidatePageContent(
  url: string,
  expected: { companyName: string; title: string },
): Promise<ContentVerificationResult> {
  const page = await fetchCandidatePage(url, expected.companyName);
  if (page.kind === 'unreachable') return { verified: false, reason: page.reason };
  const { identity } = page;
  if (identity.postingAvailable === false) {
    return { verified: false, reason: 'candidate page reports the posting is no longer available' };
  }
  if (!identity.employer) {
    return { verified: false, reason: 'no hiringOrganization.name in candidate page JSON-LD' };
  }
  if (!hiringOrganizationMatches(expected.companyName, identity.employer)) {
    return {
      verified: false,
      reason: `candidate page hiringOrganization.name "${identity.employer}" does not match expected company "${expected.companyName}"`,
    };
  }
  if (!identity.title) {
    return { verified: false, reason: 'no usable job title on candidate page' };
  }
  const overlap = titleOverlapRatio(expected.title, identity.title);
  if (overlap < HIGH_TITLE_OVERLAP) {
    return { verified: false, reason: `candidate page title overlap too low (${overlap.toFixed(2)})` };
  }

  return {
    verified: true,
    reason: `candidate page ${identity.titleSource} title and hiringOrganization.name confirm the expected job`,
  };
}

/**
 * Strategy B for one candidate: search, validate every result, accept the best HIGH candidate
 * (subject to a liveness check), fall back to the best REVIEW candidate, otherwise UNRESOLVED.
 * Never uses search output for anything but URL discovery — no Match/Coverage/candidate-fact
 * involvement anywhere in this function.
 *
 * When no candidate is structurally HIGH but the best REVIEW candidate's own hostname
 * deterministically matches the expected company (`employerDomainMatch`), one bounded
 * `verifyCandidatePageContent` fetch is attempted against that single candidate before falling
 * back to REVIEW — never more than one fetch per resolution attempt, and never for a candidate
 * that didn't already show employer-domain evidence (docs task §3-4: verification is a
 * promotion path for a promising candidate, not a substitute for the domain/title/company gates
 * above it).
 */
export async function resolveViaSearch(candidate: {
  companyName: string;
  title: string;
  locationText: string | null;
}): Promise<SearchResolutionOutcome> {
  const query = buildSearchQuery(candidate.companyName, candidate.title);
  const searchResult = await tavilySearch(query, { maxResults: SEARCH_MAX_RESULTS });
  if (searchResult.status !== 'ok' || searchResult.results.length === 0) {
    return { tier: 'UNRESOLVED', confidence: 0 };
  }

  let bestHigh: { url: string; confidence: number } | null = null;
  let bestReview: { url: string; confidence: number } | null = null;
  let bestEmployerDomainReview: { url: string; confidence: number } | null = null;

  for (const result of searchResult.results) {
    const validation = validateOfficialPostingCandidate(
      { companyName: candidate.companyName, title: candidate.title, locationText: candidate.locationText },
      { url: result.url, title: result.title, content: result.content },
    );
    if (validation.tier === 'HIGH' && (!bestHigh || validation.confidence > bestHigh.confidence)) {
      bestHigh = { url: result.url, confidence: validation.confidence };
    } else if (validation.tier === 'REVIEW') {
      if (!bestReview || validation.confidence > bestReview.confidence) {
        bestReview = { url: result.url, confidence: validation.confidence };
      }
      if (
        validation.employerDomainMatch &&
        (!bestEmployerDomainReview || validation.confidence > bestEmployerDomainReview.confidence)
      ) {
        bestEmployerDomainReview = { url: result.url, confidence: validation.confidence };
      }
    }
  }

  let bestHighContentVerified = false;
  if (!bestHigh && bestEmployerDomainReview) {
    const verification = await verifyCandidatePageContent(bestEmployerDomainReview.url, {
      companyName: candidate.companyName,
      title: candidate.title,
    });
    if (verification.verified) {
      bestHigh = { url: bestEmployerDomainReview.url, confidence: CONTENT_VERIFIED_CONFIDENCE };
      bestHighContentVerified = true;
    }
  }

  if (bestHigh) {
    // A content-verified promotion already proved identity from the page itself; a structural HIGH
    // (search-snippet evidence only) gets its identity confirmed here, in the same single fetch
    // that checks liveness. `decideHighFromConfirmation` is the one place that maps the page check
    // (plus host class) to HIGH / REVIEW / DROP.
    const decision: HighDecision = bestHighContentVerified
      ? (await isUrlReachable(bestHigh.url))
        ? 'HIGH'
        : 'REVIEW'
      : await (async () => {
          const confirmation = await confirmHighCandidatePage(bestHigh.url, {
            companyName: candidate.companyName,
            title: candidate.title,
          });
          return decideHighFromConfirmation(confirmation.outcome, confirmation.hostClass);
        })();

    if (decision === 'HIGH') {
      return { tier: 'RESOLVED_HIGH_CONFIDENCE', url: bestHigh.url, confidence: bestHigh.confidence };
    }
    // Closed/unreachable/no-identity-on-an-ATS demotes to REVIEW rather than UNRESOLVED — the match
    // evidence itself was strong, only the page couldn't confirm it (never equate a fetch failure
    // with "wrong job", only with "not auto-safe to populate as canonical"). A MISMATCH (DROP) is
    // different: the page itself says it is a different job, so the URL is dropped entirely — never
    // a HIGH, never a REVIEW candidate — and only an independent REVIEW candidate (if any) survives.
    if (decision === 'REVIEW') {
      const demoted = { url: bestHigh.url, confidence: Math.round(bestHigh.confidence * 0.8) };
      bestReview = bestReview && bestReview.confidence >= demoted.confidence ? bestReview : demoted;
    }
  }
  if (bestReview) return { tier: 'RESOLVED_REVIEW', url: bestReview.url, confidence: bestReview.confidence };
  return { tier: 'UNRESOLVED', confidence: 0 };
}

/** Tiny bounded-concurrency mapper — no new dependency. Preserves input order in the output. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export interface RunOfficialPostingResolutionSummary {
  attempted: number;
  mergedIntoAts: number;
  resolvedHighConfidence: number;
  resolvedReview: number;
  unresolved: number;
  outcomes: ResolutionOutcome[];
}

/**
 * The bounded batch entry point (`scripts/discovery/resolve-official-postings.ts`'s sole caller).
 * Builds the ATS-native dedupe index exactly once per run (Strategy A's own precedent), then tries
 * Strategy A before Strategy B for every candidate — Strategy B (a real network search) is skipped
 * entirely whenever Strategy A already finds a match, which is both the "prefer the existing
 * catalog first" instruction and most of this function's search-cost control.
 */
export async function runOfficialPostingResolution(
  supabase: CareerOsSupabaseClient,
  params: { jobrightSourceIds: string[]; atsSourceIds: string[] },
  options: { retryAfterMs: number; maxCount: number; concurrency?: number; now?: Date },
): Promise<RunOfficialPostingResolutionSummary> {
  const now = options.now ?? new Date();
  const candidates = await listOfficialPostingResolutionCandidates(supabase, params.jobrightSourceIds, {
    retryAfterMs: options.retryAfterMs,
    maxCount: options.maxCount,
    now,
  });

  const dedupeRows = await listActiveJobCatalogEntriesForDedupe(supabase, params.atsSourceIds);
  const dedupeIndex = buildCrossSourceDedupeIndex(dedupeRows);

  const allSources = await listAllJobSources(supabase);
  const sourceIdentifierById = new Map(allSources.map((source) => [source.id, source.sourceIdentifier]));

  const outcomes = await mapWithConcurrency(candidates, options.concurrency ?? 4, (candidate) =>
    resolveOneCandidate(supabase, candidate, dedupeIndex, sourceIdentifierById, now),
  );

  return {
    attempted: outcomes.length,
    mergedIntoAts: outcomes.filter((o) => o.outcome === 'MERGED_INTO_ATS').length,
    resolvedHighConfidence: outcomes.filter((o) => o.outcome === 'RESOLVED_HIGH_CONFIDENCE').length,
    resolvedReview: outcomes.filter((o) => o.outcome === 'RESOLVED_REVIEW').length,
    unresolved: outcomes.filter((o) => o.outcome === 'UNRESOLVED').length,
    outcomes,
  };
}

async function resolveOneCandidate(
  supabase: CareerOsSupabaseClient,
  candidate: OfficialPostingResolutionCandidate,
  dedupeIndex: CrossSourceDedupeIndex,
  sourceIdentifierById: Map<string, string>,
  now: Date,
): Promise<ResolutionOutcome> {
  const catalogMatch = resolveViaCatalogMatch(dedupeIndex, {
    companyName: candidate.companyName,
    title: candidate.title,
    locationText: candidate.locationText,
    postedAt: candidate.postedAt,
  });

  if (catalogMatch) {
    await mergeIntoAtsMatch(
      supabase,
      {
        jobrightJobCatalogId: candidate.jobCatalogId,
        atsJobCatalogId: catalogMatch.jobCatalogId,
        sourceIdentifier: sourceIdentifierById.get(candidate.sourceId) ?? candidate.sourceId,
        sourceJobId: candidate.sourceJobId,
        sourceUrl: candidate.sourceUrl,
      },
      now,
    );
    return {
      jobCatalogId: candidate.jobCatalogId,
      outcome: 'MERGED_INTO_ATS',
      detail: `matched ATS row ${catalogMatch.jobCatalogId}`,
    };
  }

  const searchOutcome = await resolveViaSearch(candidate);
  if (searchOutcome.tier === 'RESOLVED_HIGH_CONFIDENCE') {
    await recordOfficialPostingResolutionAttempt(
      supabase,
      candidate.jobCatalogId,
      {
        resolutionStatus: 'RESOLVED_HIGH_CONFIDENCE',
        resolutionStrategy: 'SEARCH',
        resolutionConfidence: searchOutcome.confidence,
        canonicalApplyUrl: searchOutcome.url,
      },
      candidate.resolutionAttemptCount,
      now,
    );
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'RESOLVED_HIGH_CONFIDENCE', detail: searchOutcome.url };
  }
  if (searchOutcome.tier === 'RESOLVED_REVIEW') {
    await recordOfficialPostingResolutionAttempt(
      supabase,
      candidate.jobCatalogId,
      {
        resolutionStatus: 'RESOLVED_REVIEW',
        resolutionStrategy: 'SEARCH',
        resolutionConfidence: searchOutcome.confidence,
        resolutionCandidateUrl: searchOutcome.url,
      },
      candidate.resolutionAttemptCount,
      now,
    );
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'RESOLVED_REVIEW', detail: searchOutcome.url };
  }

  await recordOfficialPostingResolutionAttempt(
    supabase,
    candidate.jobCatalogId,
    { resolutionStatus: 'UNRESOLVED', resolutionStrategy: 'SEARCH', resolutionConfidence: 0 },
    candidate.resolutionAttemptCount,
    now,
  );
  return { jobCatalogId: candidate.jobCatalogId, outcome: 'UNRESOLVED', detail: 'no confident candidate found' };
}
