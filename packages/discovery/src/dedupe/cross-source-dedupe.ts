import {
  normalizeCompanyNameForDedupe,
  normalizeJobTitle,
  normalizeLocationText,
} from '@career-os/shared';

/**
 * Cross-source dedupe (D7 §8, docs/JOB_DISCOVERY.md "Cross-source dedupe") — a Jobright GitHub
 * listing frequently re-lists a job that already exists in the catalog via the employer's own
 * Greenhouse/Lever/Ashby feed. This module decides, conservatively and deterministically, whether
 * a newly-parsed Jobright candidate is the *same real job* as an already-active catalog row from
 * a different source — never by title alone, never merging different cities or genuinely distinct
 * requisitions. A match means: don't insert a second `job_catalog` row for this candidate; the
 * caller appends a cross-source observation to the existing row instead (see
 * packages/database/src/queries/job-catalog.ts `appendCrossSourceObservation`).
 *
 * Evidence order (only two of the task's three are implementable without new capability):
 *   1. Exact match on `canonicalApplyUrl` — the strongest signal, and the only one guaranteed
 *      unambiguous.
 *   2. "Same employer ATS identity if recoverable" — not implemented. Neither the Jobright README
 *      nor its detail page ever exposes an employer's own Greenhouse/Lever/Ashby board slug, so
 *      there is nothing to recover this from.
 *   3. Normalized company + title + location, gated by a compatible posted date (within
 *      `POSTED_DATE_COMPATIBILITY_DAYS`) when both dates are actually known. Two unknown dates
 *      never block a match on their own — many source rows lack a posted date at all — but two
 *      *known*, far-apart dates are treated as different requisitions, not the same job re-posted.
 *
 * The index is built once per sync run (one query for every active, non-Jobright catalog row),
 * never once per candidate — this module is pure/synchronous and takes no Supabase client.
 */

const POSTED_DATE_COMPATIBILITY_DAYS = 3;

export interface DedupeCandidateRow {
  jobCatalogId: string;
  sourceId: string;
  companyName: string;
  title: string;
  locationText: string | null;
  canonicalApplyUrl: string | null;
  postedAt: string | null;
}

interface IndexedCandidate extends DedupeCandidateRow {
  normalizedCompany: string;
  normalizedTitleValue: string;
  normalizedLocationValue: string;
}

export interface CrossSourceDedupeIndex {
  byCanonicalUrl: Map<string, IndexedCandidate>;
  byCompanyTitleLocation: Map<string, IndexedCandidate[]>;
}

function compositeKey(company: string, title: string, location: string): string {
  return `${company}|${title}|${location}`;
}

export function buildCrossSourceDedupeIndex(rows: DedupeCandidateRow[]): CrossSourceDedupeIndex {
  const byCanonicalUrl = new Map<string, IndexedCandidate>();
  const byCompanyTitleLocation = new Map<string, IndexedCandidate[]>();

  for (const row of rows) {
    const indexed: IndexedCandidate = {
      ...row,
      normalizedCompany: normalizeCompanyNameForDedupe(row.companyName),
      normalizedTitleValue: normalizeJobTitle(row.title),
      normalizedLocationValue: row.locationText ? normalizeLocationText(row.locationText) : '',
    };

    if (row.canonicalApplyUrl) {
      // First-wins on a URL collision — an existing catalog row is never displaced by a later
      // one in the same index build.
      if (!byCanonicalUrl.has(row.canonicalApplyUrl)) {
        byCanonicalUrl.set(row.canonicalApplyUrl, indexed);
      }
    }

    const key = compositeKey(indexed.normalizedCompany, indexed.normalizedTitleValue, indexed.normalizedLocationValue);
    const bucket = byCompanyTitleLocation.get(key) ?? [];
    bucket.push(indexed);
    byCompanyTitleLocation.set(key, bucket);
  }

  return { byCanonicalUrl, byCompanyTitleLocation };
}

function daysBetween(a: string, b: string): number {
  const diffMs = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diffMs / (1000 * 60 * 60 * 24);
}

function datesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // an unknown date never blocks a match on its own
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return true;
  return daysBetween(a, b) <= POSTED_DATE_COMPATIBILITY_DAYS;
}

export interface CrossSourceDedupeCandidate {
  companyName: string;
  title: string;
  locationText: string | null;
  canonicalApplyUrl: string | null;
  postedAt: string | null;
}

/** Returns the matching existing catalog row, or null if this candidate is genuinely new. */
export function findCrossSourceDuplicate(
  index: CrossSourceDedupeIndex,
  candidate: CrossSourceDedupeCandidate,
): DedupeCandidateRow | null {
  if (candidate.canonicalApplyUrl) {
    const urlMatch = index.byCanonicalUrl.get(candidate.canonicalApplyUrl);
    if (urlMatch) return urlMatch;
  }

  const key = compositeKey(
    normalizeCompanyNameForDedupe(candidate.companyName),
    normalizeJobTitle(candidate.title),
    candidate.locationText ? normalizeLocationText(candidate.locationText) : '',
  );
  const bucket = index.byCompanyTitleLocation.get(key);
  if (!bucket) return null;

  return bucket.find((row) => datesCompatible(candidate.postedAt, row.postedAt)) ?? null;
}
