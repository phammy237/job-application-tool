import type {
  CompanyResearchFinding,
  CompanyResearchFindingCategory,
} from '../schemas/company-research';

/**
 * Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §22/§23) — bounds and ranks which of a
 * snapshot's findings are actually placed in a tailoring request's prompt. Pure and
 * deterministic: the same snapshot + same requirement ids always produce the same selection, so
 * this is trivially unit-testable without any AI/DB access, same posture as `rank-facts.ts`.
 *
 * Ranking signal, in priority order (§22):
 *   1. Overlap with this request's own job-requirement ids — a finding that already cites a
 *      requirement this specific tailoring request also offers is the strongest signal that it's
 *      relevant to *this* role, not just to the company in general.
 *   2. Whether the model recorded a `roleRelevance` at research time at all — a finding with
 *      role-specific interpretation already attached is more actionable than a bare company fact.
 *   3. A soft category boost (§23) — never a hard exclusion, so a nontechnical role isn't starved
 *      of BUSINESS/CULTURE findings just because this list exists.
 * Ties are broken by the finding's original position in the snapshot (stable sort) so the result
 * never depends on incidental object/array ordering from a downstream JSON round-trip.
 */

const REQUIREMENT_OVERLAP_WEIGHT = 4;
const ROLE_RELEVANCE_WEIGHT = 2;
const CATEGORY_BOOST_WEIGHT = 1;

/** §23 — findings in these categories are usually the most directly actionable for tailoring a
 * résumé's emphasis (what to build toward, what the company is investing in, what it's hiring
 * for), but this is a soft ranking boost only, never a filter: a BUSINESS/CULTURE/OTHER finding
 * with strong requirement overlap or role relevance can still outrank one of these. */
const BOOSTED_CATEGORIES = new Set<CompanyResearchFindingCategory>([
  'PRODUCT',
  'STRATEGY',
  'TECHNOLOGY',
  'HIRING',
  'RECENT_DEVELOPMENT',
]);

function scoreFinding(
  finding: CompanyResearchFinding,
  allowedRequirementIds: ReadonlySet<string>,
): number {
  let score = 0;
  if (finding.requirementIds.some((id) => allowedRequirementIds.has(id))) {
    score += REQUIREMENT_OVERLAP_WEIGHT;
  }
  if (finding.roleRelevance !== null) {
    score += ROLE_RELEVANCE_WEIGHT;
  }
  if (BOOSTED_CATEGORIES.has(finding.category)) {
    score += CATEGORY_BOOST_WEIGHT;
  }
  return score;
}

/**
 * Returns at most `maxFindings` findings from `findings`, highest-scoring first (stable on ties).
 * Never mutates its input. `maxFindings` is owned by the caller (packages/ai/src/config.ts's
 * `RESEARCH_TAILORING_MAX_FINDINGS`) rather than defaulted here, so this stays a pure function of
 * its explicit inputs.
 */
export function selectResumeTailoringResearchFindings(
  findings: readonly CompanyResearchFinding[],
  allowedRequirementIds: ReadonlySet<string>,
  maxFindings: number,
): CompanyResearchFinding[] {
  return findings
    .map((finding, index) => ({
      finding,
      index,
      score: scoreFinding(finding, allowedRequirementIds),
    }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index))
    .slice(0, Math.max(0, maxFindings))
    .map((entry) => entry.finding);
}
