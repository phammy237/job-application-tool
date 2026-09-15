/**
 * Deterministic, non-AI normalization of a company name for the job-discovery
 * `dedupe_fingerprint` computation only (docs/JOB_DISCOVERY.md "Company"/"Cross-source dedupe")
 * — the exact display name (`job_catalog.company_name`) is always retained separately and never
 * overwritten by this. Named distinctly from `consistency-rules.ts`'s own `normalizeCompanyName`
 * (a different, pre-existing helper for a different purpose — matching a user-typed company name
 * against a stored one) to avoid a same-name export collision; the two are deliberately NOT
 * unified, since that helper's legal-suffix stripping is exactly the aggressive normalization
 * this one avoids (see below).
 *
 * Deliberately conservative: whitespace collapsing, NFC normalization, lowercasing, and stripping
 * trailing sentence-punctuation only. It does NOT strip legal suffixes ("Inc", "LLC", "Ltd",
 * "Corp") or otherwise rewrite the name — doing so risks merging two genuinely different legal
 * entities that happen to share a common name, which is exactly the false-merge CLAUDE.md's
 * "cross-source dedupe" section warns against.
 */
export function normalizeCompanyNameForDedupe(companyName: string): string {
  return companyName
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.,]+$/, '')
    .trim();
}
