import {
  createResumeEntryId,
  type ResumeBullet,
  type ResumeBulletProvenance,
  type StructuredResumeV1,
} from '../schemas/resume-content';
import type {
  ResumeSectionName,
  ResumeTailoringCoverage,
  ResumeTailoringOperationView,
} from '../schemas/resume-tailoring';
import type {
  ResumeTailoringOperationDecision,
  ResumeTailoringOperationEdit,
} from '../schemas/resume-tailoring-review';
import { findUngroundedNumericClaims } from './resume-tailoring-numeric-guard';
import { findUngroundedTechnologyTokens } from './resume-tailoring-technology-guard';

const SECTIONS: ResumeSectionName[] = [
  'education',
  'experience',
  'projects',
  'leadership',
];

/**
 * One operation from a Phase 7E proposal, tagged with the stable id this review is tracked by.
 * `operationId` is assigned once, immediately when a proposal is received (client-side in
 * `ResumeTailoringPanel`, or server-side when a save request is revalidated) — deterministic and
 * derived from the operation's fixed position in the (never-reordered) proposal response, never
 * from the model and never from render/list position (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §4).
 */
export interface ResumeTailoringOperationWithId {
  operationId: string;
  operation: ResumeTailoringOperationView;
}

export interface ResumeTailoringGroundingViolation {
  operationId: string;
  reason: 'ungrounded_number' | 'ungrounded_technology';
  detail: string;
}

export interface BuildReviewedTailoredResumeParams {
  baseResume: StructuredResumeV1;
  operations: ResumeTailoringOperationWithId[];
  /** Missing from this map means PENDING — never defaulted to ACCEPTED (§5). */
  decisions: ReadonlyMap<string, ResumeTailoringOperationDecision>;
  /** Only meaningful for an ACCEPTED REWRITE_BULLET/ADD_BULLET; ignored otherwise. */
  edits: ReadonlyMap<string, ResumeTailoringOperationEdit>;
  /** The original Phase 7E proposal's own coverage — needed only so a requirement no operation
   * in this proposal ever cited (already unsupported before any review decision) still appears
   * in the recomputed coverage below, instead of silently disappearing (§34). The review panel
   * (which has the real proposal on hand) always passes it; the save action doesn't — it never
   * re-derives or trusts a client-submitted coverage for anything security-relevant, and the
   * `coverage` this function returns is purely informational, so `ZERO_COVERAGE` is fine there. */
  originalCoverage?: ResumeTailoringCoverage;
}

/** A coverage value with nothing in it — the safe default for a caller (the save action) that
 * has no legitimate original proposal coverage on hand and doesn't need one; see
 * `BuildReviewedTailoredResumeParams.originalCoverage` above. */
export const ZERO_RESUME_TAILORING_COVERAGE: ResumeTailoringCoverage = {
  totalRequirementCount: 0,
  coveredRequirementIds: [],
  unsupportedRequirementIds: [],
  referencedRequirementIds: [],
  unsupportedRequirements: [],
};

export interface BuildReviewedTailoredResumeResult {
  resume: StructuredResumeV1;
  counts: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    edited: number;
  };
  pendingOperationIds: string[];
  acceptedOperationIds: string[];
  rejectedOperationIds: string[];
  editedOperationIds: string[];
  /**
   * Any ACCEPTED, `KEEP_GROUNDED`-edited operation whose final text failed the same deterministic
   * numeric/technology guards Phase 7E already used (§8/§13). Never silently downgraded to MANUAL
   * or silently dropped — a non-empty list here is a hard save-block; the caller must surface it
   * and refuse to save (the pure builder itself has no such authority, since it also has to
   * produce *some* previewable resume for the UI to show what the current draft looks like).
   */
  groundingViolations: ResumeTailoringGroundingViolation[];
  /** Recomputed from ONLY the ACCEPTED operations' own cited requirements (docs/
   * IMPLEMENTATION_PLAN.md "Phase 7F" §34, option A) — never the original proposal's full-plan
   * coverage, which would misrepresent a requirement whose only citing operation was rejected as
   * still "covered." */
  coverage: ResumeTailoringCoverage;
  /** True when `resume` (ignoring `renderOverride`, which Phase 7F always resets — §39) is
   * identical to `baseResume` (also ignoring `renderOverride`) — i.e. nothing the user resolved
   * actually changes the résumé's content (§37/§38). */
  hasChangesFromBase: boolean;
}

function decisionFor(
  decisions: ReadonlyMap<string, ResumeTailoringOperationDecision>,
  operationId: string,
): ResumeTailoringOperationDecision {
  return decisions.get(operationId) ?? 'PENDING';
}

/** Structural equality ignoring key order — good enough here since neither side is ever built
 * from anything but plain JSON-shaped objects/arrays/primitives (StructuredResumeV1's own shape).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i]))
      return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

interface PendingBulletContent {
  text: string;
  provenance: ResumeBulletProvenance;
}

/**
 * The pure "apply this review's decisions to the base résumé" function (docs/
 * IMPLEMENTATION_PLAN.md "Phase 7F" §12). No DB, no AI, no randomness — the same inputs always
 * produce the same output, and `baseResume` is never mutated. Runs identically on the client (for
 * the live preview, on every Accept/Reject/Edit click) and on the server (as the authoritative
 * recomputation at save time — see `save-reviewed-tailored-resume.ts`), which is exactly why it
 * lives in `packages/shared` rather than in either app layer.
 *
 * Deliberately independent from Phase 7E's own `applyResumeTailoringPlan`: that function's
 * provenance rule ("CANDIDATE_FACTS if this rewrite cited facts, otherwise keep whatever the
 * bullet already had") is correct for an AI-authored plan applied wholesale, but wrong here — a
 * user-edited bullet must never inherit a stale grounding claim by falling through to "keep
 * existing," so every bullet this function touches gets an explicit, freshly-decided provenance
 * instead (§30).
 */
export function buildReviewedTailoredResume(
  params: BuildReviewedTailoredResumeParams,
): BuildReviewedTailoredResumeResult {
  const {
    baseResume,
    operations,
    decisions,
    edits,
    originalCoverage = ZERO_RESUME_TAILORING_COVERAGE,
  } = params;

  const pendingIds: string[] = [];
  const acceptedIds: string[] = [];
  const rejectedIds: string[] = [];
  const editedIds: string[] = [];
  const violations: ResumeTailoringGroundingViolation[] = [];

  const rewriteByBulletId = new Map<string, PendingBulletContent>();
  const omitBulletIds = new Set<string>();
  const addsByEntryId = new Map<string, PendingBulletContent[]>();
  const moveBulletTargets = new Map<string, number>();
  const omitEntryIds = new Set<string>();
  const moveEntryTargets = new Map<string, number>();
  let reorderedSkillIds: string[] | null = null;

  /** Resolves the final text + provenance for an ACCEPTED REWRITE_BULLET/ADD_BULLET, running the
   * grounding guard when the user chose to keep it fact-grounded (§8). `originalText` is the
   * bullet's pre-existing text for a rewrite (extra evidence, same as Phase 7E's own validator) —
   * null for an added bullet, which has no prior text to fall back on. */
  function resolveContent(
    operationId: string,
    proposedText: string,
    groundedFacts: { id: string; label: string }[],
    originalText: string | null,
  ): PendingBulletContent {
    const edit = edits.get(operationId);
    if (!edit) {
      return groundedFacts.length > 0
        ? {
            text: proposedText,
            provenance: {
              type: 'CANDIDATE_FACTS',
              sourceFactIds: groundedFacts.map((f) => f.id),
            },
          }
        : { text: proposedText, provenance: { type: 'MANUAL' } };
    }

    editedIds.push(operationId);
    if (edit.provenanceChoice === 'MANUAL') {
      return { text: edit.text, provenance: { type: 'MANUAL' } };
    }

    // KEEP_GROUNDED — re-run the exact same deterministic guards Phase 7E used, against the same
    // evidence (cited facts' text, plus the original bullet text for a rewrite).
    const evidenceTexts = groundedFacts.map((f) => f.label);
    if (originalText !== null) evidenceTexts.push(originalText);

    const ungroundedNumbers = findUngroundedNumericClaims(edit.text, evidenceTexts);
    if (ungroundedNumbers.length > 0) {
      violations.push({
        operationId,
        reason: 'ungrounded_number',
        detail: `"${ungroundedNumbers[0]!.raw}" is not supported by the cited evidence`,
      });
    } else {
      const ungroundedTech = findUngroundedTechnologyTokens(edit.text, evidenceTexts);
      if (ungroundedTech.length > 0) {
        violations.push({
          operationId,
          reason: 'ungrounded_technology',
          detail: `"${ungroundedTech[0]}" is not supported by the cited evidence`,
        });
      }
    }

    // A violation still needs *some* previewable, non-overclaiming result — MANUAL here is a
    // display convenience only. The caller (Save action / Save button) is responsible for
    // treating a non-empty `groundingViolations` as a hard block; this function never persists
    // anything itself.
    const failed = violations.some((v) => v.operationId === operationId);
    return failed
      ? { text: edit.text, provenance: { type: 'MANUAL' } }
      : {
          text: edit.text,
          provenance: {
            type: 'CANDIDATE_FACTS',
            sourceFactIds: groundedFacts.map((f) => f.id),
          },
        };
  }

  for (const { operationId, operation } of operations) {
    const decision = decisionFor(decisions, operationId);
    if (decision === 'PENDING') {
      pendingIds.push(operationId);
      continue;
    }
    if (decision === 'REJECTED') {
      rejectedIds.push(operationId);
      continue;
    }
    acceptedIds.push(operationId);

    switch (operation.type) {
      case 'REWRITE_BULLET': {
        const content = resolveContent(
          operationId,
          operation.after,
          operation.groundedFacts,
          operation.before,
        );
        rewriteByBulletId.set(operation.bulletId, content);
        break;
      }
      case 'ADD_BULLET': {
        // §"ADD_BULLET view" quirk carried over from Phase 7E's response builder: `bulletId` on
        // this variant actually holds the target *entry* id.
        const entryId = operation.bulletId;
        const content = resolveContent(
          operationId,
          operation.after,
          operation.groundedFacts,
          null,
        );
        const list = addsByEntryId.get(entryId) ?? [];
        list.push(content);
        addsByEntryId.set(entryId, list);
        break;
      }
      case 'OMIT_BULLET':
        omitBulletIds.add(operation.bulletId);
        break;
      case 'OMIT_ENTRY':
        omitEntryIds.add(operation.entryId);
        break;
      case 'MOVE_BULLET':
        moveBulletTargets.set(operation.bulletId, operation.toIndex);
        break;
      case 'MOVE_ENTRY':
        moveEntryTargets.set(operation.entryId, operation.toIndex);
        break;
      case 'REORDER_SKILLS':
        reorderedSkillIds = operation.orderedSkillGroupIds;
        break;
    }
  }

  function newBullet(content: PendingBulletContent): ResumeBullet {
    return {
      id: createResumeEntryId(),
      text: content.text,
      provenance: content.provenance,
    };
  }

  // Same ordering semantics as Phase 7E's applyResumeTailoringPlan: rewrite, then omit, then
  // reposition survivors, then append new bullets last.
  function applyBullets(entryId: string, bullets: ResumeBullet[]): ResumeBullet[] {
    let result = bullets.map((bullet) => {
      const content = rewriteByBulletId.get(bullet.id);
      return content
        ? { ...bullet, text: content.text, provenance: content.provenance }
        : bullet;
    });

    result = result.filter((bullet) => !omitBulletIds.has(bullet.id));

    for (const [bulletId, targetIndex] of moveBulletTargets) {
      const index = result.findIndex((bullet) => bullet.id === bulletId);
      if (index === -1) continue;
      const [item] = result.splice(index, 1);
      // Clamped by splice itself when the accepted subset shifted what "in range" means (e.g. a
      // sibling OMIT_BULLET this review rejected) — a harmless cosmetic drift, not a correctness
      // or grounding concern, so this is a deliberate simplification rather than a hard reject.
      result.splice(targetIndex, 0, item!);
    }

    for (const content of addsByEntryId.get(entryId) ?? []) {
      result.push(newBullet(content));
    }

    return result;
  }

  function applyEntries<T extends { id: string; bullets: ResumeBullet[] }>(
    entries: T[],
  ): T[] {
    let result = entries.map((entry) => ({
      ...entry,
      bullets: applyBullets(entry.id, entry.bullets),
    }));
    result = result.filter((entry) => !omitEntryIds.has(entry.id));

    for (const [entryId, targetIndex] of moveEntryTargets) {
      const index = result.findIndex((entry) => entry.id === entryId);
      if (index === -1) continue;
      const [item] = result.splice(index, 1);
      result.splice(targetIndex, 0, item!);
    }

    return result;
  }

  const resume: StructuredResumeV1 = {
    ...baseResume,
    education: applyEntries(baseResume.education),
    experience: applyEntries(baseResume.experience),
    projects: applyEntries(baseResume.projects),
    leadership: applyEntries(baseResume.leadership),
    skills: reorderedSkillIds
      ? (() => {
          const byId = new Map(baseResume.skills.map((g) => [g.id, g]));
          return reorderedSkillIds.map((id) => byId.get(id)!);
        })()
      : baseResume.skills,
    // Phase 7F never carries an Advanced LaTeX override forward — LaTeX for a tailored save is
    // always the deterministic render of this structured content (§39).
    renderOverride: null,
  };

  const coverage = recomputeReviewedCoverage(originalCoverage, operations, decisions);

  const baseForCompare = { ...baseResume, renderOverride: null };
  const resultForCompare = { ...resume, renderOverride: null };

  return {
    resume,
    counts: {
      total: operations.length,
      pending: pendingIds.length,
      accepted: acceptedIds.length,
      rejected: rejectedIds.length,
      edited: editedIds.length,
    },
    pendingOperationIds: pendingIds,
    acceptedOperationIds: acceptedIds,
    rejectedOperationIds: rejectedIds,
    editedOperationIds: editedIds,
    groundingViolations: violations,
    coverage,
    hasChangesFromBase: !deepEqual(baseForCompare, resultForCompare),
  };
}

/**
 * Recomputes requirement coverage from ONLY the operations this review actually accepted (§34,
 * option A — "requirements explicitly targeted by accepted tailoring operations"), while still
 * reporting every requirement the *original* proposal ever knew about. Deliberately
 * self-contained rather than reusing `computeResumeTailoringCoverage`: that function needs the
 * full per-request `requirementContext` (every requirement's id+text, including ones no operation
 * ever referenced), which isn't available this far from the original generation call —
 * `originalCoverage` (the Phase 7E proposal's own, already-computed coverage) stands in for it,
 * since every requirement id this function needs to label appears either on some operation's own
 * `relevantRequirements` or in `originalCoverage.unsupportedRequirements` already.
 */
export function recomputeReviewedCoverage(
  originalCoverage: ResumeTailoringCoverage,
  operations: ResumeTailoringOperationWithId[],
  decisions: ReadonlyMap<string, ResumeTailoringOperationDecision>,
): ResumeTailoringCoverage {
  const requirementTextById = new Map<string, string>(
    originalCoverage.unsupportedRequirements.map((r) => [r.id, r.text]),
  );
  const originalCoveredIds = new Set<string>();
  const referencedByAccepted = new Set<string>();

  for (const { operationId, operation } of operations) {
    if (operation.type !== 'REWRITE_BULLET' && operation.type !== 'ADD_BULLET') continue;
    for (const requirement of operation.relevantRequirements) {
      requirementTextById.set(requirement.id, requirement.text);
      originalCoveredIds.add(requirement.id);
      if (decisionFor(decisions, operationId) === 'ACCEPTED') {
        referencedByAccepted.add(requirement.id);
      }
    }
  }

  const covered = [...originalCoveredIds].filter((id) => referencedByAccepted.has(id));
  const coveredSet = new Set(covered);
  const unsupportedSet = new Set(originalCoverage.unsupportedRequirementIds);
  for (const id of originalCoveredIds) {
    if (!coveredSet.has(id)) unsupportedSet.add(id);
  }

  const unsupported = [...unsupportedSet];
  return {
    totalRequirementCount: originalCoverage.totalRequirementCount,
    coveredRequirementIds: covered,
    unsupportedRequirementIds: unsupported,
    referencedRequirementIds: [...referencedByAccepted],
    unsupportedRequirements: unsupported.map((id) => ({
      id,
      text: requirementTextById.get(id) ?? id,
    })),
  };
}
