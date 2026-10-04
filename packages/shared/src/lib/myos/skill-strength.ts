import type { GraphSkill, EvidenceGraphData } from './graph-types';
import {
  asIndex,
  buildGraphIndex,
  isUserConfirmed,
  monthsBetween,
  nodeKey,
  otherEnd,
  parseLooseDate,
  toDateOnly,
  type GraphIndex,
  type IndexedNode,
} from './graph';
import type { NodeType } from '../../schemas/myos';

/**
 * SKILL STRENGTH — transparent, rule-based, never a numeric "mastery %".
 *
 * Inputs for one skill:
 *  - Supporting entities: distinct PROJECT / EXPERIENCE / ACHIEVEMENT / STORY nodes joined to the
 *    skill by a DEMONSTRATES or USES edge (either stored direction).
 *  - Evidence: distinct EVIDENCE nodes joined by a SUPPORTS edge to the skill itself or to any
 *    of its supporting entities.
 *  - Verified evidence: evidence whose own state is VERIFIED AND whose SUPPORTS link is
 *    user-confirmed (VERIFIED or USER_PROVIDED). An AI-suggested link never makes evidence count
 *    as verified.
 *  - Recency: the latest activity date among supporting entities and linked evidence. A project
 *    or experience with a start date and no end date is ongoing (activity = now) unless the
 *    project status is COMPLETED/ARCHIVED. Stories carry no date.
 *
 * Level rules (first match wins, top to bottom):
 *  - NONE: 0 supporting entities.
 *  - STRONG: >= 3 distinct supporting entities AND >= 1 verified evidence AND latest activity
 *    within 36 months.
 *  - MODERATE: >= 2 distinct supporting entities.
 *  - LIMITED: exactly 1 supporting entity.
 *  Cap: when none of the skill's supporting edges is user-confirmed (all INFERRED/AI_GENERATED),
 *  the level is capped at LIMITED, however many entities the edges point at.
 *
 * Recency: CURRENT <= 6 months, RECENT <= 24 months, DATED older, UNKNOWN when no dated activity.
 * Quality: VERIFIED (all evidence verified), MIXED, UNVERIFIED (evidence but none verified),
 * NONE (no evidence).
 */
export const SKILL_STRENGTH_RULES = {
  strongMinEntities: 3,
  strongMinVerifiedEvidence: 1,
  strongMaxMonthsSinceActivity: 36,
  moderateMinEntities: 2,
  currentMaxMonths: 6,
  recentMaxMonths: 24,
  levels: [
    {
      level: 'NONE',
      rule: 'No project, experience, achievement, or story is linked to this skill.',
    },
    {
      level: 'LIMITED',
      rule: 'Exactly one linked item, or every link is inferred/AI-suggested and none is confirmed by you.',
    },
    { level: 'MODERATE', rule: 'Two or more distinct linked items.' },
    {
      level: 'STRONG',
      rule: 'Three or more distinct linked items, at least one verified piece of evidence, and activity within the last 36 months.',
    },
  ],
  notes: [
    'Strength is a count of supporting evidence, not a measure of proficiency.',
    'Evidence only counts as verified when its own state is VERIFIED and its link is confirmed by you.',
    'Recency uses project, experience, and achievement dates; ongoing work counts as current.',
  ],
} as const;

export type SkillStrengthLevel = 'NONE' | 'LIMITED' | 'MODERATE' | 'STRONG';
export type SkillRecency = 'CURRENT' | 'RECENT' | 'DATED' | 'UNKNOWN';
export type SkillQuality = 'VERIFIED' | 'MIXED' | 'UNVERIFIED' | 'NONE';

export interface SupportingEntity {
  type: NodeType;
  id: string;
  name: string;
}

export interface SkillStrength {
  level: SkillStrengthLevel;
  supportingEntities: SupportingEntity[];
  evidenceCount: number;
  verifiedEvidenceCount: number;
  /** YYYY-MM-DD of the most recent dated activity, or null. */
  latestActivity: string | null;
  monthsSinceLatest: number | null;
  recency: SkillRecency;
  quality: SkillQuality;
  reasons: string[];
}

const SUPPORTING_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'PROJECT',
  'EXPERIENCE',
  'ACHIEVEMENT',
  'STORY',
]);

const LEVEL_RANK: Record<SkillStrengthLevel, number> = {
  NONE: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Latest activity date of a supporting entity or evidence node; `now` for ongoing work. */
function activityDate(node: IndexedNode, now: Date): Date | null {
  switch (node.type) {
    case 'PROJECT': {
      const end = parseLooseDate(str(node.meta.endDate));
      if (end) return end;
      const start = parseLooseDate(str(node.meta.startDate));
      if (!start) return null;
      const status = str(node.meta.status);
      return status === 'COMPLETED' || status === 'ARCHIVED' ? start : now;
    }
    case 'EXPERIENCE': {
      const end = parseLooseDate(str(node.meta.endDate));
      if (end) return end;
      return parseLooseDate(str(node.meta.startDate)) ? now : null;
    }
    case 'ACHIEVEMENT':
      return parseLooseDate(str(node.meta.occurredOn));
    case 'EVIDENCE':
      return parseLooseDate(str(node.meta.occurredAt));
    default:
      return null;
  }
}

function strengthFromIndex(index: GraphIndex, skillId: string, now: Date): SkillStrength {
  const skillKey = nodeKey('SKILL', skillId);
  const entities = new Map<string, IndexedNode>();
  let confirmedSupportingEdge = false;
  for (const ie of index.adjacency.get(skillKey) ?? []) {
    if (ie.edge.relation !== 'DEMONSTRATES' && ie.edge.relation !== 'USES') continue;
    const other = index.nodes.get(otherEnd(ie, skillKey));
    if (!other || !SUPPORTING_TYPES.has(other.type)) continue;
    entities.set(other.key, other);
    if (isUserConfirmed(ie.edge.verificationState)) confirmedSupportingEdge = true;
  }

  const evidence = new Map<string, { node: IndexedNode; verified: boolean }>();
  for (const anchor of [skillKey, ...entities.keys()]) {
    for (const ie of index.adjacency.get(anchor) ?? []) {
      if (ie.edge.relation !== 'SUPPORTS') continue;
      const ev = index.nodes.get(otherEnd(ie, anchor));
      if (!ev || ev.type !== 'EVIDENCE') continue;
      const verified =
        ev.verificationHint === 'VERIFIED' && isUserConfirmed(ie.edge.verificationState);
      const prev = evidence.get(ev.key);
      evidence.set(ev.key, { node: ev, verified: verified || (prev?.verified ?? false) });
    }
  }

  const evidenceCount = evidence.size;
  const verifiedEvidenceCount = [...evidence.values()].filter((e) => e.verified).length;

  let latest: Date | null = null;
  for (const node of [
    ...entities.values(),
    ...[...evidence.values()].map((e) => e.node),
  ]) {
    const d = activityDate(node, now);
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  const effectiveLatest = latest && latest.getTime() > now.getTime() ? now : latest;
  const monthsSinceLatest = effectiveLatest ? monthsBetween(effectiveLatest, now) : null;

  const recency: SkillRecency =
    monthsSinceLatest === null
      ? 'UNKNOWN'
      : monthsSinceLatest <= SKILL_STRENGTH_RULES.currentMaxMonths
        ? 'CURRENT'
        : monthsSinceLatest <= SKILL_STRENGTH_RULES.recentMaxMonths
          ? 'RECENT'
          : 'DATED';

  const quality: SkillQuality =
    evidenceCount === 0
      ? 'NONE'
      : verifiedEvidenceCount === evidenceCount
        ? 'VERIFIED'
        : verifiedEvidenceCount === 0
          ? 'UNVERIFIED'
          : 'MIXED';

  const n = entities.size;
  const reasons: string[] = [];
  let level: SkillStrengthLevel;
  if (n === 0) {
    level = 'NONE';
    reasons.push(
      'No project, experience, achievement, or story is linked to this skill.',
    );
  } else {
    const strong =
      n >= SKILL_STRENGTH_RULES.strongMinEntities &&
      verifiedEvidenceCount >= SKILL_STRENGTH_RULES.strongMinVerifiedEvidence &&
      monthsSinceLatest !== null &&
      monthsSinceLatest <= SKILL_STRENGTH_RULES.strongMaxMonthsSinceActivity;
    level = strong
      ? 'STRONG'
      : n >= SKILL_STRENGTH_RULES.moderateMinEntities
        ? 'MODERATE'
        : 'LIMITED';
    reasons.push(`Linked to ${n} distinct item${n === 1 ? '' : 's'}.`);
    if (!confirmedSupportingEdge) {
      reasons.push(
        'Every link is inferred or AI-suggested; confirm one to lift the cap at LIMITED.',
      );
      level = 'LIMITED';
    } else if (level !== 'STRONG') {
      if (n < SKILL_STRENGTH_RULES.strongMinEntities) {
        reasons.push(
          `Strong needs ${SKILL_STRENGTH_RULES.strongMinEntities} or more distinct items.`,
        );
      }
      if (verifiedEvidenceCount < SKILL_STRENGTH_RULES.strongMinVerifiedEvidence) {
        reasons.push('Strong needs at least one verified piece of evidence.');
      }
      if (monthsSinceLatest === null) {
        reasons.push('No dated activity, so recency cannot be established.');
      } else if (monthsSinceLatest > SKILL_STRENGTH_RULES.strongMaxMonthsSinceActivity) {
        reasons.push(
          `Latest activity is ${monthsSinceLatest} months old; strong needs 36 or fewer.`,
        );
      }
    }
    reasons.push(
      evidenceCount === 0
        ? 'No supporting evidence is attached.'
        : `${verifiedEvidenceCount} of ${evidenceCount} evidence item${evidenceCount === 1 ? ' is' : 's are'} verified.`,
    );
  }

  const supportingEntities: SupportingEntity[] = [...entities.values()]
    .map((e) => ({ type: e.type, id: e.id, name: e.label }))
    .sort(
      (a, b) =>
        a.type.localeCompare(b.type) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  return {
    level,
    supportingEntities,
    evidenceCount,
    verifiedEvidenceCount,
    latestActivity: effectiveLatest ? toDateOnly(effectiveLatest) : null,
    monthsSinceLatest,
    recency,
    quality,
    reasons,
  };
}

export function computeSkillStrength(
  graph: EvidenceGraphData | GraphIndex,
  skillId: string,
  now: Date,
): SkillStrength {
  return strengthFromIndex(asIndex(graph), skillId, now);
}

export interface RankedSkillStrength {
  skill: GraphSkill;
  strength: SkillStrength;
}

/** All skills, strongest first (level, then verified evidence, entities, recency, name). */
export function computeAllSkillStrengths(
  graph: EvidenceGraphData,
  now: Date,
): RankedSkillStrength[] {
  const index = buildGraphIndex(graph);
  return graph.skills
    .map((skill) => ({ skill, strength: strengthFromIndex(index, skill.id, now) }))
    .sort((a, b) => {
      const x = a.strength;
      const y = b.strength;
      return (
        LEVEL_RANK[y.level] - LEVEL_RANK[x.level] ||
        y.verifiedEvidenceCount - x.verifiedEvidenceCount ||
        y.supportingEntities.length - x.supportingEntities.length ||
        (x.monthsSinceLatest ?? Infinity) - (y.monthsSinceLatest ?? Infinity) ||
        a.skill.name.localeCompare(b.skill.name) ||
        a.skill.id.localeCompare(b.skill.id)
      );
    });
}

// --------------------------------------------------------------------------------------------
// Evidence coverage
// --------------------------------------------------------------------------------------------

export interface CoverageGap {
  type: 'PROJECT' | 'ACHIEVEMENT' | 'STORY';
  id: string;
  name: string;
  message: string;
}

export interface EvidenceCoverage {
  total: number;
  covered: number;
  /** covered / total, or null when there is nothing to cover. */
  ratio: number | null;
  byType: Record<'PROJECT' | 'ACHIEVEMENT' | 'STORY', { total: number; covered: number }>;
  gaps: CoverageGap[];
}

const COVERAGE_NOUN = {
  PROJECT: 'project',
  ACHIEVEMENT: 'achievement',
  STORY: 'story',
} as const;

/** Share of projects, achievements, and stories with at least one linked evidence item. */
export function evidenceCoverage(
  graph: EvidenceGraphData | GraphIndex,
): EvidenceCoverage {
  const index = asIndex(graph);
  const byType: EvidenceCoverage['byType'] = {
    PROJECT: { total: 0, covered: 0 },
    ACHIEVEMENT: { total: 0, covered: 0 },
    STORY: { total: 0, covered: 0 },
  };
  const gaps: CoverageGap[] = [];
  for (const node of index.nodes.values()) {
    if (node.type !== 'PROJECT' && node.type !== 'ACHIEVEMENT' && node.type !== 'STORY')
      continue;
    const has = (index.adjacency.get(node.key) ?? []).some(
      (ie) =>
        ie.edge.relation === 'SUPPORTS' &&
        index.nodes.get(otherEnd(ie, node.key))?.type === 'EVIDENCE',
    );
    byType[node.type].total++;
    if (has) byType[node.type].covered++;
    else {
      gaps.push({
        type: node.type,
        id: node.id,
        name: node.label,
        message: `${COVERAGE_NOUN[node.type]} "${node.label}" has no evidence`,
      });
    }
  }
  gaps.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const total = byType.PROJECT.total + byType.ACHIEVEMENT.total + byType.STORY.total;
  const covered =
    byType.PROJECT.covered + byType.ACHIEVEMENT.covered + byType.STORY.covered;
  return { total, covered, ratio: total === 0 ? null : covered / total, byType, gaps };
}
