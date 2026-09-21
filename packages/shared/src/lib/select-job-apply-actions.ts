import { classifyJobPostingHost } from './classify-job-posting-host';
import { isSafeExternalUrl } from './is-safe-external-url';

/**
 * D7.1 — the single, provider-agnostic decision of what a Discover card's apply-related links
 * should be (docs/JOB_DISCOVERY.md "Official posting resolution" §5-6). Deliberately reads only
 * `canonicalApplyUrl`'s own host classification — never `resolution_status`, never
 * `source_type`/provider — so an ATS-native row (whose `canonicalApplyUrl` already classifies as
 * `ACCEPTED_ATS` today) needs zero special-casing, and a Jobright row whose resolution is later
 * downgraded (revalidation, §11) automatically falls back to the search action the moment its
 * `canonicalApplyUrl` is cleared, with no UI-side coupling to *why* it changed.
 */
export interface JobApplyActionsInput {
  companyName: string;
  title: string;
  canonicalApplyUrl: string | null;
  /** Discovery/enrichment provenance (e.g. the Jobright detail page) — never the apply URL. */
  sourceUrl: string | null;
  /** The adapter's own raw apply URL — used as the "View source" fallback only when `sourceUrl`
   * itself is absent (mirrors the D6 handoff's existing `sourceUrl ?? applyUrl` precedent). */
  applyUrl: string;
}

export interface JobApplyPrimaryAction {
  label: 'Apply on employer site';
  url: string;
}

export interface JobApplyActions {
  /** Null exactly when no confirmed employer/ATS destination exists — the UI must show the
   * search fallback instead of a broken/misleading "apply" action. */
  primary: JobApplyPrimaryAction | null;
  /** A pre-built "Find official posting" search URL — only ever populated when `primary` is null. */
  fallbackSearchUrl: string | null;
  /** "View source" — the discovery provenance, always present when a source URL exists, always
   * secondary, and never mislabeled as "Original posting" (the very copy Section 7 forbids). */
  sourceUrl: string | null;
}

/**
 * Builds a Google-search URL from public job metadata only (company + exact title + "careers") —
 * client-rendered, opened by the *user's own browser*, never fetched or scraped by Career OS
 * itself. This is the Section 5 fallback action, distinct from the server-side Tavily-backed
 * resolver (`packages/discovery`), which never runs from this function.
 */
export function buildOfficialPostingSearchUrl(companyName: string, title: string): string {
  const query = `"${companyName}" "${title}" careers`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * The Discovery → Application handoff's (D6, `POST /api/discovery/[id]/start-application`) own
 * canonical-URL decision — deliberately a *different*, narrower question from
 * `selectJobApplyActions` above, not a duplicate of it: that function decides whether to show a
 * trusted "Apply on employer site" button to a wide audience (an allowlist — only
 * `EMPLOYER_DOMAIN`/`ACCEPTED_ATS` qualify, everything else falls back to a search action, since
 * showing a wrong destination as a primary CTA is worse than showing no direct link at all). This
 * function instead decides what URL a user's own tracked application record should snapshot for
 * later reference — an already-narrower audience (one user, about a job they explicitly chose to
 * track) — so it only needs to reject a confirmed-bad value (`REJECTED_AGGREGATOR`, e.g. an
 * unresolved Jobright detail-page URL that would otherwise get snapshotted as if it were the
 * employer's own posting) rather than requiring an allowlisted host. An unlisted-but-legitimate
 * employer ATS domain (`UNKNOWN` host class) still passes through here, unlike in
 * `selectJobApplyActions`. Both functions read only `canonicalApplyUrl`'s own host classification,
 * never `resolution_status`/provenance — same reasoning as `selectJobApplyActions`'s own doc
 * comment.
 */
export function selectCanonicalHandoffUrl(canonicalApplyUrl: string | null): string | null {
  if (!canonicalApplyUrl) return null;
  return classifyJobPostingHost(canonicalApplyUrl) === 'REJECTED_AGGREGATOR' ? null : canonicalApplyUrl;
}

export function selectJobApplyActions(job: JobApplyActionsInput): JobApplyActions {
  const canonicalUrlIsSafe = job.canonicalApplyUrl ? isSafeExternalUrl(job.canonicalApplyUrl) : false;
  const hostClass =
    job.canonicalApplyUrl && canonicalUrlIsSafe ? classifyJobPostingHost(job.canonicalApplyUrl) : 'UNKNOWN';
  const isConfirmedApplyDestination = hostClass === 'EMPLOYER_DOMAIN' || hostClass === 'ACCEPTED_ATS';

  const primary: JobApplyPrimaryAction | null =
    isConfirmedApplyDestination && job.canonicalApplyUrl
      ? { label: 'Apply on employer site', url: job.canonicalApplyUrl }
      : null;

  // Try sourceUrl first, falling back to applyUrl only when sourceUrl is absent OR unsafe —
  // never render a known-unsafe URL just because it happened to be present (mirrors the
  // detail page's own pre-D7.1 precedent, which tried multiple candidates in safety order).
  const sourceUrlCandidate = job.sourceUrl && isSafeExternalUrl(job.sourceUrl) ? job.sourceUrl : null;
  const applyUrlCandidate = isSafeExternalUrl(job.applyUrl) ? job.applyUrl : null;

  return {
    primary,
    fallbackSearchUrl: primary ? null : buildOfficialPostingSearchUrl(job.companyName, job.title),
    sourceUrl: sourceUrlCandidate ?? applyUrlCandidate,
  };
}
