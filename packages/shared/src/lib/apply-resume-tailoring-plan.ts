import { createResumeEntryId, type StructuredResumeV1 } from '../schemas/resume-content';
import type { ResumeTailoringOperation } from '../schemas/resume-tailoring';

/**
 * Applies an *already-validated* plan to a copy of the base résumé — pure, deterministic, no
 * DB/model access, never mutates its input (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §20). Callers
 * must call `validateResumeTailoringPlan` first; this function trusts every id/index it's given
 * (the same posture `mark_application_applied` has toward its own already-gated inputs).
 *
 * Ordering semantics, fixed and documented (not incidental): within one entry's bullets, or one
 * section's entries, operations apply in this order — rewrite text, then omit, then reposition
 * (MOVE) the survivors among themselves, then append any newly-added bullets at the end. Added
 * bullets/entries never participate in explicit positioning; they always land last. Multiple
 * MOVE operations in the same array apply sequentially, each against the array as most recently
 * repositioned by the previous one — still fully deterministic (the same plan always produces
 * the same result), just not necessarily "commutative" if a plan contained more than one move in
 * the same array (validation's conflict matrix already guarantees at most one MOVE per entry/
 * bullet id, so this only matters when *different* ids in the same array both move).
 */
export function applyResumeTailoringPlan(
  baseResume: StructuredResumeV1,
  operations: ResumeTailoringOperation[],
): StructuredResumeV1 {
  const proposed = structuredClone(baseResume);

  const rewriteByBulletId = new Map<string, string>();
  const rewriteFactsByBulletId = new Map<string, string[]>();
  const omitBulletIds = new Set<string>();
  const addsByEntryId = new Map<string, { proposedText: string; sourceFactIds: string[] }[]>();
  const moveBulletTargets = new Map<string, number>();
  const omitEntryIds = new Set<string>();
  const moveEntryTargets = new Map<string, number>();
  let reorderedSkillIds: string[] | null = null;

  for (const op of operations) {
    switch (op.type) {
      case 'REWRITE_BULLET':
        rewriteByBulletId.set(op.bulletId, op.proposedText);
        rewriteFactsByBulletId.set(op.bulletId, op.sourceFactIds);
        break;
      case 'OMIT_BULLET':
        omitBulletIds.add(op.bulletId);
        break;
      case 'ADD_BULLET': {
        const list = addsByEntryId.get(op.entryId) ?? [];
        list.push({ proposedText: op.proposedText, sourceFactIds: op.sourceFactIds });
        addsByEntryId.set(op.entryId, list);
        break;
      }
      case 'MOVE_BULLET':
        moveBulletTargets.set(op.bulletId, op.targetIndex);
        break;
      case 'OMIT_ENTRY':
        omitEntryIds.add(op.entryId);
        break;
      case 'MOVE_ENTRY':
        moveEntryTargets.set(op.entryId, op.targetIndex);
        break;
      case 'REORDER_SKILLS':
        reorderedSkillIds = op.orderedSkillGroupIds;
        break;
    }
  }

  function applyBullets(entryId: string, bullets: StructuredResumeV1['education'][number]['bullets']) {
    // 1. Rewrite — preserves the bullet's id always; preserves its existing provenance unless
    // this rewrite cited new facts, in which case provenance reflects exactly those citations
    // (never a stale claim about facts the rewrite didn't actually use).
    let result = bullets.map((bullet) => {
      const newText = rewriteByBulletId.get(bullet.id);
      if (newText === undefined) return bullet;
      const citedFacts = rewriteFactsByBulletId.get(bullet.id) ?? [];
      return {
        ...bullet,
        text: newText,
        provenance:
          citedFacts.length > 0
            ? { type: 'CANDIDATE_FACTS' as const, sourceFactIds: citedFacts }
            : bullet.provenance,
      };
    });

    // 2. Omit.
    result = result.filter((bullet) => !omitBulletIds.has(bullet.id));

    // 3. Move survivors among themselves (targetIndex already validated against the post-omit
    // length for this exact array).
    for (const [bulletId, targetIndex] of moveBulletTargets) {
      const index = result.findIndex((bullet) => bullet.id === bulletId);
      if (index === -1) continue; // not in this array
      const [item] = result.splice(index, 1);
      result.splice(targetIndex, 0, item!);
    }

    // 4. Append new bullets, server-assigned ids — never a model-supplied id
    // (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §10/§20).
    for (const add of addsByEntryId.get(entryId) ?? []) {
      result.push({
        id: createResumeEntryId(),
        text: add.proposedText,
        provenance: { type: 'CANDIDATE_FACTS', sourceFactIds: add.sourceFactIds },
      });
    }

    return result;
  }

  function applyEntries<T extends { id: string; bullets: StructuredResumeV1['education'][number]['bullets'] }>(
    entries: T[],
  ): T[] {
    let result = entries.map((entry) => ({
      ...entry,
      bullets: applyBullets(entry.id, entry.bullets),
    }));

    result = result.filter((entry) => !omitEntryIds.has(entry.id));

    for (const [entryId, targetIndex] of moveEntryTargets) {
      const index = result.findIndex((entry) => entry.id === entryId);
      if (index === -1) continue; // not in this section
      const [item] = result.splice(index, 1);
      result.splice(targetIndex, 0, item!);
    }

    return result;
  }

  proposed.education = applyEntries(proposed.education);
  proposed.experience = applyEntries(proposed.experience);
  proposed.projects = applyEntries(proposed.projects);
  proposed.leadership = applyEntries(proposed.leadership);

  if (reorderedSkillIds) {
    const byId = new Map(proposed.skills.map((group) => [group.id, group]));
    proposed.skills = reorderedSkillIds.map((id) => byId.get(id)!);
  }

  return proposed;
}
