import { normalizeCompanyNameForDedupe } from './normalize-company-name';
import { normalizeJobTitle } from './normalize-job-title';
import { normalizeLocationText } from './normalize-location';

/**
 * A deterministic, conservative fingerprint over stable normalized fields — company, title,
 * location, and canonical apply URL when it's specific enough to be meaningful
 * (docs/JOB_DISCOVERY.md "Cross-source dedupe"). This is a pure helper for later duplicate
 * *analysis*, not an automatic merge key: D1-D3 never merges two different provider records based
 * on this fingerprint matching, only on real provider identity (source_id, source_job_id).
 *
 * A generic ATS apply URL shared by many postings on the same board (e.g. a bare
 * "https://boards.greenhouse.io/acme" landing page) is not specific enough to distinguish jobs,
 * so it's excluded from the fingerprint entirely when it isn't more specific than the board root
 * — callers pass `canonicalApplyUrl` already computed via `canonicalizeUrl`.
 */
export function computeJobCatalogDedupeFingerprint(input: {
  companyName: string;
  title: string;
  locationText: string | null;
  canonicalApplyUrl: string | null;
}): string {
  const parts = [
    normalizeCompanyNameForDedupe(input.companyName),
    normalizeJobTitle(input.title),
    input.locationText ? normalizeLocationText(input.locationText) : '',
    input.canonicalApplyUrl ?? '',
  ];
  return parts.join('|');
}
