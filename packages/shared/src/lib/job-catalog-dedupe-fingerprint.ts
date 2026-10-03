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
/** Joined with a null byte, never `|` — job titles routinely contain a literal pipe (e.g.
 * "Software Engineer | Backend", a common real posting format), so a `|`-joined fingerprint can
 * collide between two different (company, title) pairs whenever a pipe lands at a field boundary
 * (e.g. company "Acme | Co" + title "X" vs. company "Acme" + title "Co | X"). A null byte can't
 * appear in any of these normalized parts in practice, so this delimiter is unambiguous. */
const FINGERPRINT_DELIMITER = '\u0000';

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
  return parts.join(FINGERPRINT_DELIMITER);
}
