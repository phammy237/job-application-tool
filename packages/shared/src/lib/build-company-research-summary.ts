import type { CompanyResearchFinding } from '../schemas/company-research';
import type { CompanyResearchFindingCategory } from '../schemas/company-research';

/** Preference order for which categories' claims lead the executive summary — role/product
 * relevance first, broad company context last (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §45: "role
 * relevance, source quality, materiality, recency" as the report's own ranking hierarchy). */
const CATEGORY_PRIORITY: CompanyResearchFindingCategory[] = [
  'PRODUCT',
  'STRATEGY',
  'RECENT_DEVELOPMENT',
  'TECHNOLOGY',
  'BUSINESS',
  'HIRING',
  'CULTURE',
  'OTHER',
];

const SUMMARY_MAX_FINDINGS = 3;
const SUMMARY_MAX_CHARS = 600;

/**
 * Deterministically derives the executive summary from already-validated findings — never a
 * separate free-text field the model could fill with a claim no finding actually supports (§50:
 * "avoids 'summary says something sources never supported'"). Picks at most one finding per
 * category, in `CATEGORY_PRIORITY` order, in the original (model-returned) order within each
 * category, and joins their `claim` text — nothing here is written by this function, only
 * selected and concatenated.
 *
 * Pure, deterministic, no AI/DB access. Returns `''` for an empty findings array (defensive —
 * `validateCompanyResearchPlan` already guarantees at least one finding by the time this runs in
 * the real pipeline).
 */
export function buildCompanyResearchSummary(findings: CompanyResearchFinding[]): string {
  const byCategory = new Map<CompanyResearchFindingCategory, CompanyResearchFinding>();
  for (const finding of findings) {
    if (!byCategory.has(finding.category)) {
      byCategory.set(finding.category, finding);
    }
  }

  const selected = CATEGORY_PRIORITY.map((category) => byCategory.get(category))
    .filter((finding): finding is CompanyResearchFinding => finding !== undefined)
    .slice(0, SUMMARY_MAX_FINDINGS);

  const joined = selected.map((finding) => finding.claim).join(' ');
  return joined.length > SUMMARY_MAX_CHARS
    ? `${joined.slice(0, SUMMARY_MAX_CHARS - 1)}…`
    : joined;
}
