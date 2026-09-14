import type { ApprovedFactForGeneration } from '@career-os/database';
import type { RequirementEvidenceMappingWithValidity, StructuredResumeV1 } from '@career-os/shared';
import { RESUME_TAILORING_MAX_FACTS } from '../config';

/**
 * Bounded, deterministic fact-selection strategy for résumé tailoring
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §7) — a résumé-tailoring prompt is not scored against
 * one job field the way `retrieval/score-fact.ts` scores a single answer, so that pipeline's
 * keyword/category scoring (built for a `Job` + one `FieldClassification`) doesn't apply cleanly
 * here; this is a separate, purpose-built strategy documented on its own terms rather than a
 * forced reuse.
 *
 * Priority order, each tier added before the next and every fact deduplicated by id:
 * 1. Facts already cited by the base résumé's own bullets (`CANDIDATE_FACTS` provenance) — the
 *    résumé the user is tailoring already relies on these; they are always relevant context.
 * 2. Facts cited by the CURRENT requirement-mapping run's `matchedFacts`, when one exists — the
 *    strongest available signal for "this fact addresses a real requirement of this job."
 * 3. The remaining approved facts, in the caller's own already-approved order, until
 *    `RESUME_TAILORING_MAX_FACTS` total facts are reached — a deterministic, order-stable
 *    fallback that never silently drops a fact tiers 1–2 already selected, only trims how many
 *    *additional* facts beyond those are offered.
 *
 * Every fact returned still had to pass `listOwnApprovedFactsForGeneration`'s own approval filter
 * — this function only orders/bounds an already-approved-only list, it never widens what's
 * eligible in the first place (CLAUDE.md's data-minimization rule).
 */
export function selectResumeTailoringFacts(
  allApprovedFacts: ApprovedFactForGeneration[],
  baseResume: StructuredResumeV1,
  currentMapping: RequirementEvidenceMappingWithValidity[] | null,
): ApprovedFactForGeneration[] {
  const byId = new Map(allApprovedFacts.map((fact) => [fact.id, fact]));
  const selected: ApprovedFactForGeneration[] = [];
  const selectedIds = new Set<string>();

  function add(id: string) {
    if (selectedIds.has(id)) return;
    const fact = byId.get(id);
    if (!fact) return; // not currently an approved fact — never included regardless of citation
    selected.push(fact);
    selectedIds.add(id);
  }

  const SECTIONS: (keyof Pick<
    StructuredResumeV1,
    'education' | 'experience' | 'projects' | 'leadership'
  >)[] = ['education', 'experience', 'projects', 'leadership'];
  for (const section of SECTIONS) {
    for (const entry of baseResume[section]) {
      for (const bullet of entry.bullets) {
        if (bullet.provenance.type === 'CANDIDATE_FACTS') {
          bullet.provenance.sourceFactIds.forEach(add);
        }
      }
    }
  }

  if (currentMapping) {
    for (const mapping of currentMapping) {
      for (const fact of mapping.matchedFacts) {
        if (fact.validity === 'valid') add(fact.factId);
      }
    }
  }

  for (const fact of allApprovedFacts) {
    if (selected.length >= RESUME_TAILORING_MAX_FACTS) break;
    add(fact.id);
  }

  return selected;
}
