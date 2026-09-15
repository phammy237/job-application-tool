import type { CompanyResearchRelevanceItem } from '../schemas/resume-tailoring';

/**
 * Phase 7I — resolves an item's `researchFindingIds` into human-readable `companyRelevance`
 * (never a raw uuid shown to the user), and computes the server-side-only summary counts the
 * final `InterviewPrepResult` needs (`docs/IMPLEMENTATION_PLAN.md` "Phase 7I" — "Do not trust the
 * model to describe its own provenance... must be computed server-side"). Deliberately generic
 * over every interview-prep item shape (`rolePriorities`, `evidenceToEmphasize`, ...) rather than
 * six near-duplicate resolver functions — same "one resolver, applied per section" posture as
 * Phase 7H's own `resume-tailoring-response.ts`.
 */

export interface ResearchFindingContext {
  claim: string;
  roleRelevance: string | null;
  category: string;
}

/** Resolves one item's `researchFindingIds` into `companyRelevance`, dropping (never
 * fabricating) an id with no resolvable context — mirrors resume-tailoring-response.ts's own
 * `companyRelevance` helper exactly. */
function resolveCompanyRelevance(
  ids: readonly string[],
  researchFindingsById: ReadonlyMap<string, ResearchFindingContext>,
): CompanyResearchRelevanceItem[] {
  return ids
    .map((id) => {
      const finding = researchFindingsById.get(id);
      return finding ? { id, ...finding } : null;
    })
    .filter((item): item is CompanyResearchRelevanceItem => item !== null);
}

/**
 * Resolves one array of raw model items (each with `researchFindingIds`) into the corresponding
 * array of view items (each with `companyRelevance` instead) — a plain, type-preserving map, used
 * once per interview-prep section.
 */
export function resolveInterviewPrepItemsCompanyRelevance<
  T extends { researchFindingIds: readonly string[] },
>(
  items: readonly T[],
  researchFindingsById: ReadonlyMap<string, ResearchFindingContext>,
): (Omit<T, 'researchFindingIds'> & { companyRelevance: CompanyResearchRelevanceItem[] })[] {
  return items.map((item) => {
    const { researchFindingIds, ...rest } = item;
    return { ...rest, companyRelevance: resolveCompanyRelevance(researchFindingIds, researchFindingsById) };
  });
}

/** Server-computed research-influence counters across every section of a validated interview-prep
 * plan — never trusted from the model. `researchFindingsReferenced` counts distinct finding ids
 * cited anywhere; `itemsInfluencedByResearch` counts items (across every section) whose
 * `researchFindingIds` was non-empty. */
export function computeInterviewPrepResearchSummary(
  allItemResearchFindingIds: readonly (readonly string[])[],
): { researchFindingsReferenced: number; itemsInfluencedByResearch: number } {
  const referenced = new Set<string>();
  let itemsInfluencedByResearch = 0;
  for (const ids of allItemResearchFindingIds) {
    if (ids.length > 0) {
      itemsInfluencedByResearch += 1;
      for (const id of ids) referenced.add(id);
    }
  }
  return { researchFindingsReferenced: referenced.size, itemsInfluencedByResearch };
}
