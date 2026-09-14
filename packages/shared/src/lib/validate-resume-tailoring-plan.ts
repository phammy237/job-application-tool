import type { ResumeBullet, StructuredResumeV1 } from '../schemas/resume-content';
import type {
  ResumeSectionName,
  ResumeTailoringOperation,
  ResumeTailoringPlan,
} from '../schemas/resume-tailoring';
import { findUngroundedNumericClaims } from './resume-tailoring-numeric-guard';
import { findUngroundedTechnologyTokens } from './resume-tailoring-technology-guard';

const SECTIONS: ResumeSectionName[] = ['education', 'experience', 'projects', 'leadership'];

export type ResumeTailoringRejectionReason =
  | 'unknown_bullet_id'
  | 'unknown_entry_id'
  | 'unknown_skill_group_id'
  | 'invalid_skill_reorder'
  | 'unknown_fact_id'
  | 'unknown_requirement_id'
  | 'invalid_target_index'
  | 'operation_conflict'
  | 'ungrounded_number'
  | 'ungrounded_technology';

export type ValidateResumeTailoringPlanResult =
  | { status: 'ok'; operations: ResumeTailoringOperation[] }
  | { status: 'rejected'; reason: ResumeTailoringRejectionReason; detail: string };

export interface ResumeTailoringAllowlists {
  /** Every approved fact id actually placed in this request's prompt — request-local, not "any
   * id that exists in the database" (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §17). */
  factIds: ReadonlySet<string>;
  factTextById: ReadonlyMap<string, string>;
  /** Every requirement id actually placed in this request's prompt — either
   * `requirement_evidence_mappings.id` values (mapping present) or synthesized per-request ids
   * over the job snapshot's own qualification lists (mapping absent, §5). Request-local either
   * way. */
  requirementIds: ReadonlySet<string>;
}

interface BulletLocation {
  section: ResumeSectionName;
  entryId: string;
  bullet: ResumeBullet;
}

interface EntryLocation {
  section: ResumeSectionName;
  id: string;
}

interface BaseResumeIndex {
  bulletsById: Map<string, BulletLocation>;
  entriesById: Map<string, EntryLocation>;
  skillGroupIds: Set<string>;
  sectionLength: Record<ResumeSectionName, number>;
}

function indexBaseResume(baseResume: StructuredResumeV1): BaseResumeIndex {
  const bulletsById = new Map<string, BulletLocation>();
  const entriesById = new Map<string, EntryLocation>();
  const sectionLength: Record<ResumeSectionName, number> = {
    education: baseResume.education.length,
    experience: baseResume.experience.length,
    projects: baseResume.projects.length,
    leadership: baseResume.leadership.length,
  };

  for (const section of SECTIONS) {
    for (const entry of baseResume[section]) {
      entriesById.set(entry.id, { section, id: entry.id });
      for (const bullet of entry.bullets) {
        bulletsById.set(bullet.id, { section, entryId: entry.id, bullet });
      }
    }
  }

  return {
    bulletsById,
    entriesById,
    skillGroupIds: new Set(baseResume.skills.map((g) => g.id)),
    sectionLength,
  };
}

function rejected(
  reason: ResumeTailoringRejectionReason,
  detail: string,
): ValidateResumeTailoringPlanResult {
  return { status: 'rejected', reason, detail };
}

/**
 * The deep semantic validation gate (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §2) — pure, no DB/
 * model access. Runs *after* `resumeTailoringPlanSchema` has already confirmed the model's
 * response has the right shape (packages/ai's contract layer); this function checks everything
 * shape validation cannot: that every referenced id actually exists in *this* base résumé and
 * was actually offered in *this* request's allowlists, that the plan is internally
 * non-contradictory, and that no proposed text introduces an unsupported number or technology.
 * Any single failure rejects the *entire* plan — there is no partial application of a plan where
 * only some operations passed (matching this codebase's existing all-or-nothing posture for
 * requirement-mapping runs, docs/AI_GROUNDING.md §8).
 */
export function validateResumeTailoringPlan(
  plan: ResumeTailoringPlan,
  baseResume: StructuredResumeV1,
  allowlists: ResumeTailoringAllowlists,
): ValidateResumeTailoringPlanResult {
  const index = indexBaseResume(baseResume);
  const { operations } = plan;

  // ---- Pass 1: every referenced id resolves against THIS base résumé, and every citation
  // resolves against THIS request's allowlists. ----
  for (const op of operations) {
    switch (op.type) {
      case 'REWRITE_BULLET':
      case 'OMIT_BULLET':
      case 'MOVE_BULLET': {
        if (!index.bulletsById.has(op.bulletId)) {
          return rejected('unknown_bullet_id', `bulletId "${op.bulletId}" is not in the base résumé`);
        }
        break;
      }
      case 'ADD_BULLET':
      case 'OMIT_ENTRY':
      case 'MOVE_ENTRY': {
        if (!index.entriesById.has(op.entryId)) {
          return rejected('unknown_entry_id', `entryId "${op.entryId}" is not in the base résumé`);
        }
        break;
      }
      case 'REORDER_SKILLS': {
        const provided = new Set(op.orderedSkillGroupIds);
        if (provided.size !== op.orderedSkillGroupIds.length) {
          return rejected('invalid_skill_reorder', 'orderedSkillGroupIds contains a duplicate id');
        }
        if (
          provided.size !== index.skillGroupIds.size ||
          [...provided].some((id) => !index.skillGroupIds.has(id))
        ) {
          return rejected(
            'invalid_skill_reorder',
            'orderedSkillGroupIds must be exactly the base résumé\'s existing skill group ids, reordered',
          );
        }
        break;
      }
    }

    if ('sourceFactIds' in op) {
      for (const factId of op.sourceFactIds) {
        if (!allowlists.factIds.has(factId)) {
          return rejected('unknown_fact_id', `sourceFactId "${factId}" was not offered in this request`);
        }
      }
    }
    if ('requirementIds' in op) {
      for (const requirementId of op.requirementIds) {
        if (!allowlists.requirementIds.has(requirementId)) {
          return rejected(
            'unknown_requirement_id',
            `requirementId "${requirementId}" was not offered in this request`,
          );
        }
      }
    }
  }

  // ---- Pass 2: conflict matrix (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §18) — at most one
  // structural operation may target any given bullet or entry across the whole plan, an omitted
  // entry accepts no further operations (including ADD_BULLET or any bullet-level op on one of
  // its own bullets), and MOVE/OMIT never combine on the same entry. ----
  const bulletOpCount = new Map<string, number>();
  const entryExclusiveOpCount = new Map<string, number>();
  const omittedEntryIds = new Set<string>();

  for (const op of operations) {
    if (op.type === 'REWRITE_BULLET' || op.type === 'OMIT_BULLET' || op.type === 'MOVE_BULLET') {
      bulletOpCount.set(op.bulletId, (bulletOpCount.get(op.bulletId) ?? 0) + 1);
    }
    if (op.type === 'OMIT_ENTRY' || op.type === 'MOVE_ENTRY') {
      entryExclusiveOpCount.set(op.entryId, (entryExclusiveOpCount.get(op.entryId) ?? 0) + 1);
    }
    if (op.type === 'OMIT_ENTRY') {
      omittedEntryIds.add(op.entryId);
    }
  }

  for (const [id, count] of bulletOpCount) {
    if (count > 1) {
      return rejected('operation_conflict', `more than one operation targets bulletId "${id}"`);
    }
  }
  for (const [id, count] of entryExclusiveOpCount) {
    if (count > 1) {
      return rejected(
        'operation_conflict',
        `more than one OMIT_ENTRY/MOVE_ENTRY operation targets entryId "${id}"`,
      );
    }
  }
  for (const op of operations) {
    if (op.type === 'ADD_BULLET' && omittedEntryIds.has(op.entryId)) {
      return rejected(
        'operation_conflict',
        `ADD_BULLET targets entryId "${op.entryId}", which OMIT_ENTRY also targets`,
      );
    }
    if (
      (op.type === 'REWRITE_BULLET' || op.type === 'OMIT_BULLET' || op.type === 'MOVE_BULLET') &&
      omittedEntryIds.has(index.bulletsById.get(op.bulletId)!.entryId)
    ) {
      return rejected(
        'operation_conflict',
        `bulletId "${op.bulletId}" belongs to an entry that OMIT_ENTRY also targets`,
      );
    }
  }

  // ---- Pass 3: MOVE target-index bounds, computed against the length *after* this same plan's
  // own omits in that array (never the raw pre-omit length — see apply-resume-tailoring-plan.ts's
  // doc comment for why: added bullets/entries always append at the end and never participate in
  // explicit positioning, so a move's valid range is exactly the surviving-item count). ----
  const omittedBulletIdsByEntry = new Map<string, Set<string>>();
  for (const op of operations) {
    if (op.type === 'OMIT_BULLET') {
      const loc = index.bulletsById.get(op.bulletId)!;
      const set = omittedBulletIdsByEntry.get(loc.entryId) ?? new Set<string>();
      set.add(op.bulletId);
      omittedBulletIdsByEntry.set(loc.entryId, set);
    }
  }

  for (const op of operations) {
    if (op.type === 'MOVE_BULLET') {
      const loc = index.bulletsById.get(op.bulletId)!;
      const entry = baseResume[loc.section].find((e) => e.id === loc.entryId)!;
      const omitted = omittedBulletIdsByEntry.get(loc.entryId)?.size ?? 0;
      const postOmitLength = entry.bullets.length - omitted;
      if (op.targetIndex >= postOmitLength) {
        return rejected(
          'invalid_target_index',
          `MOVE_BULLET targetIndex ${op.targetIndex} is out of range for bulletId "${op.bulletId}" (${postOmitLength} bullet(s) remain)`,
        );
      }
    }
    if (op.type === 'MOVE_ENTRY') {
      const loc = index.entriesById.get(op.entryId)!;
      const omitted = operations.filter(
        (o) => o.type === 'OMIT_ENTRY' && index.entriesById.get(o.entryId)?.section === loc.section,
      ).length;
      const postOmitLength = index.sectionLength[loc.section] - omitted;
      if (op.targetIndex >= postOmitLength) {
        return rejected(
          'invalid_target_index',
          `MOVE_ENTRY targetIndex ${op.targetIndex} is out of range for entryId "${op.entryId}" (${postOmitLength} entry/entries remain)`,
        );
      }
    }
  }

  // ---- Pass 4: deterministic numeric/technology grounding for every newly-proposed text
  // (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §15/§16). ----
  for (const op of operations) {
    if (op.type !== 'REWRITE_BULLET' && op.type !== 'ADD_BULLET') continue;

    const evidenceTexts: string[] = op.sourceFactIds
      .map((id) => allowlists.factTextById.get(id))
      .filter((text): text is string => Boolean(text));
    if (op.type === 'REWRITE_BULLET') {
      evidenceTexts.push(index.bulletsById.get(op.bulletId)!.bullet.text);
    }

    const ungroundedNumbers = findUngroundedNumericClaims(op.proposedText, evidenceTexts);
    if (ungroundedNumbers.length > 0) {
      return rejected(
        'ungrounded_number',
        `proposed text introduces an unsupported number: "${ungroundedNumbers[0]!.raw}"`,
      );
    }

    const ungroundedTech = findUngroundedTechnologyTokens(op.proposedText, evidenceTexts);
    if (ungroundedTech.length > 0) {
      return rejected(
        'ungrounded_technology',
        `proposed text introduces an unsupported term: "${ungroundedTech[0]}"`,
      );
    }
  }

  return { status: 'ok', operations };
}
