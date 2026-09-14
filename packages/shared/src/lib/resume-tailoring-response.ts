import type { StructuredResumeV1 } from '../schemas/resume-content';
import type {
  ResumeSectionName,
  ResumeTailoringCoverage,
  ResumeTailoringOperation,
  ResumeTailoringOperationView,
  ResumeTailoringSummary,
} from '../schemas/resume-tailoring';

const SECTIONS: ResumeSectionName[] = ['education', 'experience', 'projects', 'leadership'];

function resolveEntryLabel(
  section: ResumeSectionName,
  entry: StructuredResumeV1['education'][number] | StructuredResumeV1['experience'][number] | StructuredResumeV1['projects'][number] | StructuredResumeV1['leadership'][number],
): string {
  switch (section) {
    case 'education':
      return (entry as StructuredResumeV1['education'][number]).institution;
    case 'experience': {
      const e = entry as StructuredResumeV1['experience'][number];
      return `${e.role} at ${e.organization}`;
    }
    case 'projects':
      return (entry as StructuredResumeV1['projects'][number]).name;
    case 'leadership':
      return (entry as StructuredResumeV1['leadership'][number]).organization;
  }
}

interface BaseIndex {
  bulletText: Map<string, string>;
  bulletEntryLabel: Map<string, string>;
  bulletEntryAndIndex: Map<string, { section: ResumeSectionName; entryId: string; index: number }>;
  entryLabel: Map<string, string>;
  entryIndex: Map<string, { section: ResumeSectionName; index: number }>;
  skillGroupItems: Map<string, string[]>;
}

function indexForDisplay(baseResume: StructuredResumeV1): BaseIndex {
  const index: BaseIndex = {
    bulletText: new Map(),
    bulletEntryLabel: new Map(),
    bulletEntryAndIndex: new Map(),
    entryLabel: new Map(),
    entryIndex: new Map(),
    skillGroupItems: new Map(),
  };

  for (const section of SECTIONS) {
    baseResume[section].forEach((entry, entryIndex) => {
      const label = resolveEntryLabel(section, entry);
      index.entryLabel.set(entry.id, label);
      index.entryIndex.set(entry.id, { section, index: entryIndex });
      entry.bullets.forEach((bullet, bulletIndex) => {
        index.bulletText.set(bullet.id, bullet.text);
        index.bulletEntryLabel.set(bullet.id, label);
        index.bulletEntryAndIndex.set(bullet.id, { section, entryId: entry.id, index: bulletIndex });
      });
    });
  }
  for (const group of baseResume.skills) {
    index.skillGroupItems.set(group.id, group.items);
  }

  return index;
}

/**
 * Resolves before/after text, entry labels, and human-readable citations for the UI (§28/§29) —
 * raw ids are never the primary display; every value here is resolved from the actual base
 * résumé and the actual request-local label maps, never echoed from anything the model claimed.
 */
export function buildResumeTailoringOperationViews(
  operations: ResumeTailoringOperation[],
  baseResume: StructuredResumeV1,
  factLabelById: ReadonlyMap<string, string>,
  requirementTextById: ReadonlyMap<string, string>,
): ResumeTailoringOperationView[] {
  const index = indexForDisplay(baseResume);

  function groundedFacts(ids: string[]) {
    return ids.map((id) => ({ id, label: factLabelById.get(id) ?? id }));
  }
  function relevantRequirements(ids: string[]) {
    return ids.map((id) => ({ id, text: requirementTextById.get(id) ?? id }));
  }

  return operations.map((op): ResumeTailoringOperationView => {
    switch (op.type) {
      case 'REWRITE_BULLET':
        return {
          type: 'REWRITE_BULLET',
          bulletId: op.bulletId,
          entryLabel: index.bulletEntryLabel.get(op.bulletId) ?? '',
          before: index.bulletText.get(op.bulletId) ?? '',
          after: op.proposedText,
          groundedFacts: groundedFacts(op.sourceFactIds),
          relevantRequirements: relevantRequirements(op.requirementIds),
          reason: op.reason,
        };
      case 'ADD_BULLET':
        return {
          type: 'ADD_BULLET',
          bulletId: op.entryId,
          entryLabel: index.entryLabel.get(op.entryId) ?? '',
          after: op.proposedText,
          groundedFacts: groundedFacts(op.sourceFactIds),
          relevantRequirements: relevantRequirements(op.requirementIds),
          reason: op.reason,
        };
      case 'OMIT_BULLET':
        return {
          type: 'OMIT_BULLET',
          bulletId: op.bulletId,
          entryLabel: index.bulletEntryLabel.get(op.bulletId) ?? '',
          omittedText: index.bulletText.get(op.bulletId) ?? '',
          reason: op.reason,
        };
      case 'OMIT_ENTRY':
        return {
          type: 'OMIT_ENTRY',
          entryId: op.entryId,
          entryLabel: index.entryLabel.get(op.entryId) ?? '',
          reason: op.reason,
        };
      case 'MOVE_BULLET': {
        const loc = index.bulletEntryAndIndex.get(op.bulletId);
        return {
          type: 'MOVE_BULLET',
          bulletId: op.bulletId,
          entryLabel: index.bulletEntryLabel.get(op.bulletId) ?? '',
          movedText: index.bulletText.get(op.bulletId) ?? '',
          fromIndex: loc?.index ?? -1,
          toIndex: op.targetIndex,
          reason: op.reason,
        };
      }
      case 'MOVE_ENTRY': {
        const loc = index.entryIndex.get(op.entryId);
        return {
          type: 'MOVE_ENTRY',
          entryId: op.entryId,
          entryLabel: index.entryLabel.get(op.entryId) ?? '',
          fromIndex: loc?.index ?? -1,
          toIndex: op.targetIndex,
          reason: op.reason,
        };
      }
      case 'REORDER_SKILLS': {
        const before = baseResume.skills.map((g) => g.label);
        const byId = new Map(baseResume.skills.map((g) => [g.id, g.label]));
        const after = op.orderedSkillGroupIds.map((id) => byId.get(id) ?? id);
        return { type: 'REORDER_SKILLS', before, after, reason: op.reason };
      }
    }
  });
}

/** Server-computed operation-type counts (§27) — never trusted from the model. */
export function computeResumeTailoringSummary(
  operations: ResumeTailoringOperation[],
): ResumeTailoringSummary {
  const summary: ResumeTailoringSummary = {
    rewrittenBullets: 0,
    addedBullets: 0,
    omittedBullets: 0,
    omittedEntries: 0,
    movedBullets: 0,
    movedEntries: 0,
    skillsReordered: false,
    requirementsReferenced: 0,
  };
  const referenced = new Set<string>();

  for (const op of operations) {
    switch (op.type) {
      case 'REWRITE_BULLET':
        summary.rewrittenBullets += 1;
        op.requirementIds.forEach((id) => referenced.add(id));
        break;
      case 'ADD_BULLET':
        summary.addedBullets += 1;
        op.requirementIds.forEach((id) => referenced.add(id));
        break;
      case 'OMIT_BULLET':
        summary.omittedBullets += 1;
        break;
      case 'OMIT_ENTRY':
        summary.omittedEntries += 1;
        break;
      case 'MOVE_BULLET':
        summary.movedBullets += 1;
        break;
      case 'MOVE_ENTRY':
        summary.movedEntries += 1;
        break;
      case 'REORDER_SKILLS':
        summary.skillsReordered = true;
        break;
    }
  }

  summary.requirementsReferenced = referenced.size;
  return summary;
}

/**
 * Factual requirement coverage (§25/§26) — never an aggregate score. When `mappingIsMissing` is
 * provided (a real Phase 5A requirement-mapping run exists), coverage reflects that mapping's
 * own MISSING/non-MISSING relationships. When it's `null` (no mapping — the fallback path, §5),
 * coverage reflects *only* what this specific validated plan actually cited — never invented,
 * and never "assume covered" for anything the plan didn't touch.
 */
export function computeResumeTailoringCoverage(
  operations: ResumeTailoringOperation[],
  requirementContext: { id: string; text: string }[],
  mappingIsMissing: ReadonlyMap<string, boolean> | null,
): ResumeTailoringCoverage {
  const referenced = new Set<string>();
  for (const op of operations) {
    if ('requirementIds' in op) op.requirementIds.forEach((id) => referenced.add(id));
  }

  const covered: string[] = [];
  const unsupported: string[] = [];
  for (const requirement of requirementContext) {
    const isUnsupported = mappingIsMissing
      ? (mappingIsMissing.get(requirement.id) ?? true)
      : !referenced.has(requirement.id);
    if (isUnsupported) {
      unsupported.push(requirement.id);
    } else {
      covered.push(requirement.id);
    }
  }

  return {
    totalRequirementCount: requirementContext.length,
    coveredRequirementIds: covered,
    unsupportedRequirementIds: unsupported,
    referencedRequirementIds: [...referenced],
    unsupportedRequirements: requirementContext.filter((r) => unsupported.includes(r.id)),
  };
}
