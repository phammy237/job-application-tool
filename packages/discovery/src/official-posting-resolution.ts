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
import { isSafeExternalUrl, type CrossSourceObservation } from '@career-os/shared';
import {
  buildCrossSourceDedupeIndex,
  findCrossSourceDuplicate,
  type CrossSourceDedupeIndex,
} from './dedupe/cross-source-dedupe';
import { validateOfficialPostingCandidate } from './official-posting-validator';

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
 * right now." Never used to decide REVIEW; only gates HIGH (docs task §3 "STATUS"). */
async function isUrlReachable(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) return false;
  try {
    const headResponse = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (headResponse.status === 405 || headResponse.status === 501) {
      const getResponse = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS),
        redirect: 'follow',
      });
      return getResponse.ok;
    }
    return headResponse.ok;
  } catch {
    return false;
  }
}

export type SearchResolutionOutcome =
  | { tier: 'RESOLVED_HIGH_CONFIDENCE'; url: string; confidence: number }
  | { tier: 'RESOLVED_REVIEW'; url: string; confidence: number }
  | { tier: 'UNRESOLVED'; confidence: number };

/**
 * Strategy B for one candidate: search, validate every result, accept the best HIGH candidate
 * (subject to a liveness check), fall back to the best REVIEW candidate, otherwise UNRESOLVED.
 * Never uses search output for anything but URL discovery — no Match/Coverage/candidate-fact
 * involvement anywhere in this function.
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

  for (const result of searchResult.results) {
    const validation = validateOfficialPostingCandidate(
      { companyName: candidate.companyName, title: candidate.title, locationText: candidate.locationText },
      { url: result.url, title: result.title, content: result.content },
    );
    if (validation.tier === 'HIGH' && (!bestHigh || validation.confidence > bestHigh.confidence)) {
      bestHigh = { url: result.url, confidence: validation.confidence };
    } else if (
      validation.tier === 'REVIEW' &&
      (!bestReview || validation.confidence > bestReview.confidence)
    ) {
      bestReview = { url: result.url, confidence: validation.confidence };
    }
  }

  if (bestHigh) {
    const reachable = await isUrlReachable(bestHigh.url);
    if (reachable) return { tier: 'RESOLVED_HIGH_CONFIDENCE', url: bestHigh.url, confidence: bestHigh.confidence };
    // Unreachable right now demotes to REVIEW rather than UNRESOLVED — the match evidence itself
    // was strong, only liveness couldn't be confirmed (never equate a fetch failure with "wrong
    // job", only with "not auto-safe to populate as canonical").
    const demoted = { url: bestHigh.url, confidence: Math.round(bestHigh.confidence * 0.8) };
    bestReview = bestReview && bestReview.confidence >= demoted.confidence ? bestReview : demoted;
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
