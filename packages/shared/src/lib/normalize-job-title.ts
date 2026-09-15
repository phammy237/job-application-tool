/**
 * Deterministic, non-AI normalization of a job title for comparison/search
 * (docs/JOB_DISCOVERY.md "Normalization"). This is a canonical comparison representation, NOT a
 * predicted role family/taxonomy — it never rewrites semantic meaning (e.g. "Sr. Engineer" and
 * "Senior Engineer" deliberately do NOT normalize identically; that's D4 territory).
 *
 * What it does: Unicode NFC normalization, whitespace collapsing/trimming, lowercasing for
 * comparison, and consistent spacing around a small set of common separator punctuation (so
 * "Engineer,Backend" and "Engineer, Backend" normalize identically). Nothing else.
 */
export function normalizeJobTitle(title: string): string {
  return title
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*([,/&])\s*/g, ' $1 ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
