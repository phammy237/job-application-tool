import type { StructuredResumeV1 } from '../schemas/resume-content';
import type {
  ResumeSectionName,
  ResumeTailoringOperationView,
} from '../schemas/resume-tailoring';
import type {
  ResumeTailoringOperationDecision,
  ResumeTailoringOperationEdit,
} from '../schemas/resume-tailoring-review';
import type { ResumeTailoringOperationWithId } from './build-reviewed-tailored-resume';
import { findUngroundedNumericClaims } from './resume-tailoring-numeric-guard';
import { findUngroundedTechnologyTokens } from './resume-tailoring-technology-guard';

const SECTIONS: ResumeSectionName[] = [
  'education',
  'experience',
  'projects',
  'leadership',
];

export type ResumeTailoringSaveRejectionReason =
  | 'unresolved_operations'
  | 'unknown_bullet_id'
  | 'unknown_entry_id'
  | 'invalid_skill_reorder'
  | 'operation_conflict'
  | 'unknown_fact_id'
  | 'ungrounded_number'
  | 'ungrounded_technology';

export type ValidateResumeTailoringSaveResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: ResumeTailoringSaveRejectionReason; detail: string };

interface BaseResumeIndex {
  bulletIds: Set<string>;
  bulletTextById: Map<string, string>;
  entryIdByBulletId: Map<string, string>;
  entryIds: Set<string>;
  skillGroupIds: Set<string>;
}

function indexBaseResume(baseResume: StructuredResumeV1): BaseResumeIndex {
  const bulletIds = new Set<string>();
  const bulletTextById = new Map<string, string>();
  const entryIdByBulletId = new Map<string, string>();
  const entryIds = new Set<string>();
  for (const section of SECTIONS) {
    for (const entry of baseResume[section]) {
      entryIds.add(entry.id);
      for (const bullet of entry.bullets) {
        bulletIds.add(bullet.id);
        bulletTextById.set(bullet.id, bullet.text);
        entryIdByBulletId.set(bullet.id, entry.id);
      }
    }
  }
  return {
    bulletIds,
    bulletTextById,
    entryIdByBulletId,
    entryIds,
    skillGroupIds: new Set(baseResume.skills.map((g) => g.id)),
  };
}

function decisionFor(
  decisions: ReadonlyMap<string, ResumeTailoringOperationDecision>,
  operationId: string,
): ResumeTailoringOperationDecision {
  return decisions.get(operationId) ?? 'PENDING';
}

/** The final text + effective cited fact ids for an ACCEPTED REWRITE_BULLET/ADD_BULLET, given its
 * edit (if any) — identical logic to `buildReviewedTailoredResume`'s own `resolveContent`, kept
 * separate here because this function's job is different: verifying the claim against FRESH,
 * server-derived data, not producing a previewable result from client-supplied evidence. */
function effectiveGroundedContent(
  operation: Extract<
    ResumeTailoringOperationView,
    { type: 'REWRITE_BULLET' | 'ADD_BULLET' }
  >,
  edit: ResumeTailoringOperationEdit | undefined,
): { text: string; claimsGrounding: boolean; sourceFactIds: string[] } {
  if (!edit) {
    return {
      text: operation.after,
      claimsGrounding: true,
      sourceFactIds: operation.groundedFacts.map((f) => f.id),
    };
  }
  if (edit.provenanceChoice === 'MANUAL') {
    return { text: edit.text, claimsGrounding: false, sourceFactIds: [] };
  }
  return {
    text: edit.text,
    claimsGrounding: true,
    sourceFactIds: operation.groundedFacts.map((f) => f.id),
  };
}

/**
 * The server-side authoritative gate for Phase 7F's save path (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7F" §13/§48) — never trusts the client's own `groundedFacts` labels or `before` text as
 * evidence, the way `buildReviewedTailoredResume`'s client-facing preview necessarily does.
 * Everything here is checked against data this call's caller fetched fresh from the database
 * *after* confirming the base résumé version and job snapshot are still current — `approvedFactIds`
 * /`factTextById` must be the user's CURRENTLY-approved facts, not anything echoed from the
 * original (ephemeral, unpersisted) Phase 7E proposal.
 *
 * Checks, in order, any one of which rejects the entire save:
 *   1. every operation has an explicit ACCEPTED/REJECTED decision — no PENDING left (§35).
 *   2. every ACCEPTED operation's bulletId/entryId actually exists in `baseResume` (§13).
 *   3. an ACCEPTED REORDER_SKILLS's orderedSkillGroupIds is exactly the base résumé's own skill
 *      group ids, permuted — never a fabricated set (§13/§48).
 *   4. no two ACCEPTED operations exclusively target the same bulletId/entryId, and no ACCEPTED
 *      bullet-level operation targets a bullet whose entry another ACCEPTED OMIT_ENTRY also
 *      targets (same conflict shape as Phase 7E's own validator, scoped to what's actually
 *      accepted rather than the full original plan).
 *   5. every ACCEPTED REWRITE_BULLET/ADD_BULLET that still claims fact-grounded provenance (no
 *      edit, or a `KEEP_GROUNDED` edit) cites only ids in `approvedFactIds`, and its final text
 *      re-passes the same deterministic numeric/technology guards Phase 7E used — against the
 *      REAL cited facts' text and the REAL base bullet text, never the client's own claims about
 *      either (§8/§13/§51).
 */
export function validateResumeTailoringSaveSubmission(params: {
  baseResume: StructuredResumeV1;
  operations: ResumeTailoringOperationWithId[];
  decisions: ReadonlyMap<string, ResumeTailoringOperationDecision>;
  edits: ReadonlyMap<string, ResumeTailoringOperationEdit>;
  approvedFactIds: ReadonlySet<string>;
  factTextById: ReadonlyMap<string, string>;
}): ValidateResumeTailoringSaveResult {
  const { baseResume, operations, decisions, edits, approvedFactIds, factTextById } =
    params;
  const index = indexBaseResume(baseResume);

  for (const { operationId } of operations) {
    if (decisionFor(decisions, operationId) === 'PENDING') {
      return {
        status: 'rejected',
        reason: 'unresolved_operations',
        detail: `operation "${operationId}" was never accepted or rejected`,
      };
    }
  }

  const accepted = operations.filter(
    ({ operationId }) => decisionFor(decisions, operationId) === 'ACCEPTED',
  );

  for (const { operation } of accepted) {
    switch (operation.type) {
      case 'REWRITE_BULLET':
      case 'OMIT_BULLET':
      case 'MOVE_BULLET':
        if (!index.bulletIds.has(operation.bulletId)) {
          return {
            status: 'rejected',
            reason: 'unknown_bullet_id',
            detail: operation.bulletId,
          };
        }
        break;
      case 'ADD_BULLET':
        // §"ADD_BULLET view" quirk: `bulletId` on this variant holds the target entry id.
        if (!index.entryIds.has(operation.bulletId)) {
          return {
            status: 'rejected',
            reason: 'unknown_entry_id',
            detail: operation.bulletId,
          };
        }
        break;
      case 'OMIT_ENTRY':
      case 'MOVE_ENTRY':
        if (!index.entryIds.has(operation.entryId)) {
          return {
            status: 'rejected',
            reason: 'unknown_entry_id',
            detail: operation.entryId,
          };
        }
        break;
      case 'REORDER_SKILLS': {
        const provided = new Set(operation.orderedSkillGroupIds);
        if (
          provided.size !== operation.orderedSkillGroupIds.length ||
          provided.size !== index.skillGroupIds.size ||
          [...provided].some((id) => !index.skillGroupIds.has(id))
        ) {
          return {
            status: 'rejected',
            reason: 'invalid_skill_reorder',
            detail:
              "orderedSkillGroupIds must be exactly the base résumé's existing skill group ids, reordered",
          };
        }
        break;
      }
    }
  }

  const bulletOpCount = new Map<string, number>();
  const entryExclusiveOpCount = new Map<string, number>();
  const omittedEntryIds = new Set<string>();
  for (const { operation } of accepted) {
    if (
      operation.type === 'REWRITE_BULLET' ||
      operation.type === 'OMIT_BULLET' ||
      operation.type === 'MOVE_BULLET'
    ) {
      bulletOpCount.set(
        operation.bulletId,
        (bulletOpCount.get(operation.bulletId) ?? 0) + 1,
      );
    }
    if (operation.type === 'OMIT_ENTRY' || operation.type === 'MOVE_ENTRY') {
      entryExclusiveOpCount.set(
        operation.entryId,
        (entryExclusiveOpCount.get(operation.entryId) ?? 0) + 1,
      );
      if (operation.type === 'OMIT_ENTRY') omittedEntryIds.add(operation.entryId);
    }
  }
  for (const [id, count] of bulletOpCount) {
    if (count > 1)
      return { status: 'rejected', reason: 'operation_conflict', detail: id };
  }
  for (const [id, count] of entryExclusiveOpCount) {
    if (count > 1)
      return { status: 'rejected', reason: 'operation_conflict', detail: id };
  }
  for (const { operation } of accepted) {
    if (operation.type === 'ADD_BULLET' && omittedEntryIds.has(operation.bulletId)) {
      return {
        status: 'rejected',
        reason: 'operation_conflict',
        detail: operation.bulletId,
      };
    }
    if (
      operation.type === 'REWRITE_BULLET' ||
      operation.type === 'OMIT_BULLET' ||
      operation.type === 'MOVE_BULLET'
    ) {
      const entryId = index.entryIdByBulletId.get(operation.bulletId);
      if (entryId && omittedEntryIds.has(entryId)) {
        return {
          status: 'rejected',
          reason: 'operation_conflict',
          detail: operation.bulletId,
        };
      }
    }
  }

  for (const { operationId, operation } of accepted) {
    if (operation.type !== 'REWRITE_BULLET' && operation.type !== 'ADD_BULLET') continue;
    const { text, claimsGrounding, sourceFactIds } = effectiveGroundedContent(
      operation,
      edits.get(operationId),
    );
    if (!claimsGrounding) continue; // MANUAL — no fact/grounding claim to verify.

    for (const factId of sourceFactIds) {
      if (!approvedFactIds.has(factId)) {
        return { status: 'rejected', reason: 'unknown_fact_id', detail: factId };
      }
    }

    const evidenceTexts = sourceFactIds
      .map((id) => factTextById.get(id))
      .filter((t): t is string => Boolean(t));
    if (operation.type === 'REWRITE_BULLET') {
      const realOriginalText = index.bulletTextById.get(operation.bulletId);
      if (realOriginalText) evidenceTexts.push(realOriginalText);
    }

    const ungroundedNumbers = findUngroundedNumericClaims(text, evidenceTexts);
    if (ungroundedNumbers.length > 0) {
      return {
        status: 'rejected',
        reason: 'ungrounded_number',
        detail: ungroundedNumbers[0]!.raw,
      };
    }
    const ungroundedTech = findUngroundedTechnologyTokens(text, evidenceTexts);
    if (ungroundedTech.length > 0) {
      return {
        status: 'rejected',
        reason: 'ungrounded_technology',
        detail: ungroundedTech[0]!,
      };
    }
  }

  return { status: 'ok' };
}
