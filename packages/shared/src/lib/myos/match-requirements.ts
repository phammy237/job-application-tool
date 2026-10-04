import type {
  EvidenceSourceType,
  MyosEdge,
  NodeType,
  VerificationState,
} from '../../schemas/myos';
import type { EvidenceGraphData } from './graph-types';
import { matchTokensWithRelated, scoreTextMatch } from './text';

/**
 * Requirement ↔ evidence matching. Pure and deterministic; never invents anything: every
 * `supports` entry is a stored entity, every evidence row a stored evidence row, every sentence
 * of `explanation` is a template filled from stored names.
 *
 * STRENGTH RULES (documented, transparent):
 *  - A support is **firm** when: the entity is user-approved, it is linked to a skill named in the
 *    requirement through a graph edge (`via: 'skill-edge'`), that edge is VERIFIED/USER_PROVIDED,
 *    and the skill itself is user-approved.
 *  - An entity's **backing** is the best *effective* verification among its linked evidence, where
 *    an evidence link's effective state is the weaker of the edge state and the evidence row state.
 *  - STRONG   = ≥2 distinct firm entities AND ≥1 of them backed by VERIFIED/USER_PROVIDED evidence.
 *  - MODERATE = 1 firm entity backed by VERIFIED/USER_PROVIDED evidence, OR ≥2 firm entities
 *               without such backing.
 *  - LIMITED  = anything else that matched: a text-only match, an unapproved entity
 *               (`unconfirmed: true`), an INFERRED/AI_GENERATED edge, or a single firm entity with
 *               no solid evidence.
 *  - NONE     = nothing matched. Nothing is invented: "No meaningful evidence found".
 *  Text-only matches, unapproved entities and INFERRED/AI_GENERATED edges can never lift above
 *  LIMITED.
 *
 * RELATED concepts ("LLM" requirement, "ML" skill; "analytics" requirement, "SQL" skill) are
 * asymmetric and never identical: a support found only through a related skill/concept is flagged
 * `related: true`, is never firm, and so can never lift the level above LIMITED.
 *
 * VERDICT: requirements without a category are treated as REQUIRED (conservative). REQUIRED weighs 2,
 * PREFERRED weighs 1; level scores STRONG 1 / MODERATE 0.65 / LIMITED 0.3 / NONE 0.
 * STRONG_FIT = weighted fit ≥ 0.65 and no REQUIRED gap; WEAK_FIT = fit < 0.35, or at least half of
 * the REQUIRED requirements are gaps, or there are no requirements to judge; else PARTIAL_FIT.
 */

export type SupportEntityType = 'PROJECT' | 'EXPERIENCE' | 'ACHIEVEMENT' | 'STORY';
export type RequirementLevel = 'STRONG' | 'MODERATE' | 'LIMITED' | 'NONE';

const VERIFICATION_RANK: Record<VerificationState, number> = {
  VERIFIED: 3,
  USER_PROVIDED: 2,
  INFERRED: 1,
  AI_GENERATED: 0,
};

export function verificationRank(state: VerificationState): number {
  return VERIFICATION_RANK[state];
}

export function weakerState(a: VerificationState, b: VerificationState): VerificationState {
  return VERIFICATION_RANK[a] <= VERIFICATION_RANK[b] ? a : b;
}

/** True for states a user (or a verified source) stands behind. */
export function isSolidState(state: VerificationState): boolean {
  return VERIFICATION_RANK[state] >= VERIFICATION_RANK.USER_PROVIDED;
}

export interface EvidenceRef {
  evidenceId: string;
  title: string;
  sourceType: EvidenceSourceType;
  /** Effective state: the weaker of the evidence row and the edge linking it. */
  verificationState: VerificationState;
  sourceUrl: string | null;
}

export interface SupportEntity {
  entityType: SupportEntityType;
  entityId: string;
  key: string;
  name: string;
  /** All free text of the entity, for lexical matching. */
  text: string;
  approved: boolean;
  /** Stricter: also approved for use in applications (projects/experiences). */
  approvedForApplications: boolean;
  /** Own verification state (achievements/stories), null for projects/experiences. */
  ownState: VerificationState | null;
  /** Achievement metric text (stored verbatim), else null. */
  metric: string | null;
  skills: { skillId: string; state: VerificationState }[];
  /** Sorted best-first (verification, then title). */
  evidence: EvidenceRef[];
  /** Keys (`TYPE:id`) of directly related entities (edges between entities, achievement→project). */
  related: string[];
}

export interface SupportIndex {
  entities: SupportEntity[];
  byKey: Map<string, SupportEntity>;
  skillById: Map<string, { id: string; name: string; approved: boolean }>;
}

export function entityKey(type: NodeType, id: string): string {
  return `${type}:${id}`;
}

function isSupportType(t: NodeType): t is SupportEntityType {
  return t === 'PROJECT' || t === 'EXPERIENCE' || t === 'ACHIEVEMENT' || t === 'STORY';
}

function joinText(parts: (string | null | undefined | string[])[]): string {
  return parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join('. ');
}

export function buildSupportIndex(graph: EvidenceGraphData): SupportIndex {
  const entities: SupportEntity[] = [];
  const byKey = new Map<string, SupportEntity>();
  const add = (e: Omit<SupportEntity, 'key' | 'skills' | 'evidence' | 'related'>): void => {
    const full: SupportEntity = {
      ...e,
      key: entityKey(e.entityType, e.entityId),
      skills: [],
      evidence: [],
      related: [],
    };
    entities.push(full);
    byKey.set(full.key, full);
  };

  for (const p of graph.projects) {
    add({
      entityType: 'PROJECT',
      entityId: p.id,
      name: p.name,
      text: joinText([p.name, p.description, p.summary, p.role, p.tags, p.talkingPoints]),
      approved: p.userApproved,
      approvedForApplications: p.userApproved && p.approvedForApplications,
      ownState: null,
      metric: null,
    });
  }
  for (const x of graph.experiences) {
    add({
      entityType: 'EXPERIENCE',
      entityId: x.id,
      name: `${x.title} at ${x.company}`,
      text: joinText([x.title, x.company, x.description, x.tags]),
      approved: x.userApproved,
      approvedForApplications: x.userApproved && x.approvedForApplications,
      ownState: null,
      metric: null,
    });
  }
  for (const a of graph.achievements) {
    add({
      entityType: 'ACHIEVEMENT',
      entityId: a.id,
      name: a.title,
      text: joinText([a.title, a.description, a.metricText]),
      approved: a.userApproved,
      approvedForApplications: a.userApproved,
      ownState: a.verificationState,
      metric: a.metricText,
    });
  }
  for (const s of graph.stories) {
    add({
      entityType: 'STORY',
      entityId: s.id,
      name: s.title,
      text: joinText([s.title, s.situation, s.task, s.action, s.result, s.themes]),
      approved: s.userApproved,
      approvedForApplications: s.userApproved,
      ownState: s.verificationState,
      metric: null,
    });
  }

  const evidenceById = new Map(graph.evidence.map((e) => [e.id, e]));
  const skillById = new Map(
    graph.skills.map((s) => [s.id, { id: s.id, name: s.name, approved: s.userApproved }]),
  );

  const link = (a: SupportEntity, b: SupportEntity): void => {
    if (a.key === b.key) return;
    if (!a.related.includes(b.key)) a.related.push(b.key);
    if (!b.related.includes(a.key)) b.related.push(a.key);
  };

  for (const a of graph.achievements) {
    const self = byKey.get(entityKey('ACHIEVEMENT', a.id));
    if (!self) continue;
    for (const [type, id] of [
      ['PROJECT', a.projectId],
      ['EXPERIENCE', a.experienceId],
    ] as const) {
      const other = id ? byKey.get(entityKey(type, id)) : undefined;
      if (other) link(self, other);
    }
  }

  const processEdge = (edge: MyosEdge): void => {
    const ends: [NodeType, string][] = [
      [edge.fromType, edge.fromId],
      [edge.toType, edge.toId],
    ];
    for (let i = 0; i < 2; i++) {
      const [type, id] = ends[i]!;
      const [otherType, otherId] = ends[1 - i]!;
      if (!isSupportType(type)) continue;
      const self = byKey.get(entityKey(type, id));
      if (!self) continue;
      if (otherType === 'SKILL') {
        if (!skillById.has(otherId)) continue;
        const existing = self.skills.find((s) => s.skillId === otherId);
        if (!existing) self.skills.push({ skillId: otherId, state: edge.verificationState });
        else if (verificationRank(edge.verificationState) > verificationRank(existing.state)) {
          existing.state = edge.verificationState;
        }
      } else if (otherType === 'EVIDENCE') {
        const ev = evidenceById.get(otherId);
        if (!ev) continue;
        const state = weakerState(ev.verificationState, edge.verificationState);
        const existing = self.evidence.find((r) => r.evidenceId === ev.id);
        if (existing) {
          if (verificationRank(state) > verificationRank(existing.verificationState)) {
            existing.verificationState = state;
          }
        } else {
          self.evidence.push({
            evidenceId: ev.id,
            title: ev.title,
            sourceType: ev.sourceType,
            verificationState: state,
            sourceUrl: ev.sourceUrl,
          });
        }
      } else if (isSupportType(otherType)) {
        const other = byKey.get(entityKey(otherType, otherId));
        if (other) link(self, other);
      }
    }
  };
  graph.edges.forEach(processEdge);

  for (const e of entities) {
    e.evidence.sort(
      (a, b) =>
        verificationRank(b.verificationState) - verificationRank(a.verificationState) ||
        a.title.localeCompare(b.title),
    );
  }
  return { entities, byKey, skillById };
}

/** Best effective evidence state of an entity, or null when it has no linked evidence. */
export function bestEvidenceState(e: SupportEntity): VerificationState | null {
  return e.evidence[0]?.verificationState ?? null;
}

// --------------------------------------------------------------------------------------------
// Requirement matching
// --------------------------------------------------------------------------------------------

export interface RequirementInput {
  id: string;
  text: string;
  category?: 'REQUIRED' | 'PREFERRED';
}

export interface RequirementSupport {
  entityType: SupportEntityType;
  entityId: string;
  name: string;
  via: 'skill-edge' | 'text-match';
  /** True when the entity is not user-approved yet (e.g. just imported from GitHub). */
  unconfirmed?: true;
  /** True when matched only through a related (not identical) concept; caps the level at LIMITED. */
  related?: true;
  evidence: {
    evidenceId: string;
    title: string;
    sourceType: EvidenceSourceType;
    verificationState: VerificationState;
    sourceUrl: string | null;
  }[];
}

export interface RequirementMatch {
  requirementId: string;
  requirementText: string;
  category: 'REQUIRED' | 'PREFERRED';
  level: RequirementLevel;
  skills: { id: string; name: string }[];
  /** Skills related to, but not the same as, what the requirement names. */
  relatedSkills?: { id: string; name: string }[];
  supports: RequirementSupport[];
  explanation: string;
  /** True only when level is NONE. */
  gap: boolean;
}

export interface RequirementMatchSummary {
  strong: number;
  moderate: number;
  limited: number;
  none: number;
  requiredGaps: string[];
  overallVerdict: 'STRONG_FIT' | 'PARTIAL_FIT' | 'WEAK_FIT';
}

export interface RequirementMatchResult {
  matches: RequirementMatch[];
  summary: RequirementMatchSummary;
}

const MAX_SUPPORTS = 6;
const TEXT_MATCH_MIN_SCORE = 0.3;

interface Candidate {
  entity: SupportEntity;
  via: 'skill-edge' | 'text-match';
  firm: boolean;
  related: boolean;
  textScore: number;
}

const LEVEL_SCORE: Record<RequirementLevel, number> = {
  STRONG: 1,
  MODERATE: 0.65,
  LIMITED: 0.3,
  NONE: 0,
};

export function matchRequirementsToEvidence(
  graph: EvidenceGraphData,
  requirements: RequirementInput[],
  now: Date,
): RequirementMatchResult {
  void now; // reserved for recency weighting; matching itself is time-independent
  const index = buildSupportIndex(graph);
  const matches = requirements.map((r) => matchOne(index, r));

  const counts = { STRONG: 0, MODERATE: 0, LIMITED: 0, NONE: 0 };
  let weightSum = 0;
  let scoreSum = 0;
  const requiredGaps: string[] = [];
  let requiredTotal = 0;
  for (const m of matches) {
    counts[m.level] += 1;
    const w = m.category === 'REQUIRED' ? 2 : 1;
    weightSum += w;
    scoreSum += w * LEVEL_SCORE[m.level];
    if (m.category === 'REQUIRED') {
      requiredTotal += 1;
      if (m.level === 'NONE') requiredGaps.push(m.requirementText);
    }
  }
  const fit = weightSum === 0 ? 0 : scoreSum / weightSum;
  let verdict: RequirementMatchSummary['overallVerdict'];
  if (matches.length === 0 || fit < 0.35 || (requiredTotal > 0 && requiredGaps.length * 2 >= requiredTotal)) {
    verdict = 'WEAK_FIT';
  } else if (fit >= 0.65 && requiredGaps.length === 0) {
    verdict = 'STRONG_FIT';
  } else {
    verdict = 'PARTIAL_FIT';
  }
  return {
    matches,
    summary: {
      strong: counts.STRONG,
      moderate: counts.MODERATE,
      limited: counts.LIMITED,
      none: counts.NONE,
      requiredGaps,
      overallVerdict: verdict,
    },
  };
}

function matchOne(index: SupportIndex, req: RequirementInput): RequirementMatch {
  const category = req.category ?? 'REQUIRED';
  const matchedSkills: { id: string; name: string; approved: boolean }[] = [];
  const relatedSkills: { id: string; name: string; approved: boolean }[] = [];
  for (const sk of index.skillById.values()) {
    const kind = matchTokensWithRelated(req.text, sk.name);
    if (kind === 'exact') matchedSkills.push(sk);
    else if (kind === 'related') relatedSkills.push(sk);
  }
  const skillIds = new Set(matchedSkills.map((s) => s.id));
  const relatedIds = new Set(relatedSkills.map((s) => s.id));

  const candidates = new Map<string, Candidate>();
  for (const entity of index.entities) {
    const links = entity.skills.filter((l) => skillIds.has(l.skillId));
    if (links.length > 0) {
      const firm =
        entity.approved &&
        links.some((l) => isSolidState(l.state) && index.skillById.get(l.skillId)?.approved);
      candidates.set(entity.key, { entity, via: 'skill-edge', firm, related: false, textScore: 0 });
      continue;
    }
    if (entity.skills.some((l) => relatedIds.has(l.skillId))) {
      candidates.set(entity.key, {
        entity,
        via: 'skill-edge',
        firm: false,
        related: true,
        textScore: 0,
      });
      continue;
    }
    const m = scoreTextMatch(req.text, entity.text, { allowRelated: true });
    const relatedOnly = m.relatedConcepts.length > 0 && !m.conceptMatch;
    if (
      m.score >= TEXT_MATCH_MIN_SCORE &&
      (m.conceptMatch || m.matchedTerms.length >= 2 || m.relatedConcepts.length > 0)
    ) {
      candidates.set(entity.key, {
        entity,
        via: 'text-match',
        firm: false,
        related: relatedOnly,
        textScore: m.score,
      });
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) =>
      Number(b.firm) - Number(a.firm) ||
      Number(a.related) - Number(b.related) ||
      Number(b.entity.approved) - Number(a.entity.approved) ||
      evidenceRank(b.entity) - evidenceRank(a.entity) ||
      b.textScore - a.textScore ||
      a.entity.name.localeCompare(b.entity.name),
  );

  const firm = ranked.filter((c) => c.firm);
  const firmBacked = firm.filter((c) => {
    const s = bestEvidenceState(c.entity);
    return s !== null && isSolidState(s);
  });
  let level: RequirementLevel;
  if (ranked.length === 0) level = 'NONE';
  else if (firm.length >= 2 && firmBacked.length >= 1) level = 'STRONG';
  else if ((firm.length >= 1 && firmBacked.length >= 1) || firm.length >= 2) level = 'MODERATE';
  else level = 'LIMITED';

  const supports: RequirementSupport[] = ranked.slice(0, MAX_SUPPORTS).map((c) => ({
    entityType: c.entity.entityType,
    entityId: c.entity.entityId,
    name: c.entity.name,
    via: c.via,
    ...(c.entity.approved ? {} : { unconfirmed: true as const }),
    ...(c.related ? { related: true as const } : {}),
    evidence: c.entity.evidence.map((e) => ({ ...e })),
  }));

  return {
    requirementId: req.id,
    requirementText: req.text,
    category,
    level,
    skills: matchedSkills.map((s) => ({ id: s.id, name: s.name })),
    ...(relatedSkills.length > 0
      ? { relatedSkills: relatedSkills.map((s) => ({ id: s.id, name: s.name })) }
      : {}),
    supports,
    explanation:
      explain(level, supports, matchedSkills.map((s) => s.name), ranked) +
      (supports.some((x) => x.related)
        ? ' Related, not identical: some matches rest on a related concept, so they cannot count beyond limited support.'
        : ''),
    gap: level === 'NONE',
  };
}

function evidenceRank(e: SupportEntity): number {
  const s = bestEvidenceState(e);
  return s === null ? -1 : verificationRank(s);
}

function describe(s: RequirementSupport): string {
  const kind = s.entityType.toLowerCase();
  return `${kind} "${s.name}"${s.unconfirmed ? ' (unconfirmed)' : ''}`;
}

function explain(
  level: RequirementLevel,
  supports: RequirementSupport[],
  skillNames: string[],
  ranked: Candidate[],
): string {
  if (level === 'NONE') return 'No meaningful evidence found.';
  const names = supports.slice(0, 3).map(describe).join(', ');
  const skillPart = skillNames.length > 0 ? ` Skills named in the requirement: ${skillNames.join(', ')}.` : '';
  const unconfirmed = supports.some((s) => s.unconfirmed)
    ? ' Some matches are unconfirmed - approve them to count fully.'
    : '';
  switch (level) {
    case 'STRONG':
      return `Supported by ${ranked.filter((c) => c.firm).length} approved entities with solid evidence, e.g. ${names}.${skillPart}`;
    case 'MODERATE':
      return `Some solid support: ${names}.${skillPart}${unconfirmed}`;
    default:
      return `Only limited support (text overlap, unconfirmed, inferred or unevidenced links): ${names}.${skillPart}${unconfirmed}`;
  }
}

/** Compact one-line-per-requirement display strings. */
export function toRequirementEvidenceSummary(result: RequirementMatchResult): string[] {
  const lines = result.matches.map((m) => {
    const tag = m.category === 'REQUIRED' ? 'required' : 'preferred';
    const shown = m.supports.slice(0, 3).map((s) => s.name);
    const tail = m.level === 'NONE' ? 'no meaningful evidence found' : shown.join('; ');
    return `[${m.level}] (${tag}) ${m.requirementText} -> ${tail}`;
  });
  const s = result.summary;
  lines.push(
    `Summary: ${s.strong} strong, ${s.moderate} moderate, ${s.limited} limited, ${s.none} none; ` +
      `${s.requiredGaps.length} required gap(s); verdict ${s.overallVerdict}`,
  );
  return lines;
}

// --------------------------------------------------------------------------------------------
// Requirement extraction from a pasted job description
// --------------------------------------------------------------------------------------------

const MAX_REQUIREMENTS = 25;
const MAX_REQ_LENGTH = 300;
const BULLET_RE = /^\s*(?:[-*•●▪–]|\d+[.)])\s+/;
const PREFERRED_HEADING_RE = /\b(preferred|nice to have|bonus|pluses|good to have|a plus)\b/i;
const REQUIRED_HEADING_RE =
  /\b(requirements?|qualifications?|must[- ]have|minimum|what you.?ll bring|what we.?re looking for|you have|basic qualifications)\b/i;
const DUTIES_HEADING_RE = /\b(responsibilit|what you.?ll do|the role|in this role|about the job)\b/i;
const REQUIREMENT_CUE_RE =
  /\b(experience|ability|proficien|knowledge|familiar|skills?|years|must|required|degree|expertise|understanding|background|comfortable|capable|passion)\b/i;
const PREFERRED_CUE_RE = /\b(preferred|nice to have|bonus|a plus|ideally|is a plus|are a plus)\b/i;
const REQUIRED_CUE_RE = /\b(required|must|minimum|need to|requires?)\b/i;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (BULLET_RE.test(line)) return false;
  return /:$/.test(t) || (!/[.!?]$/.test(t) && t.split(/\s+/).length <= 6);
}

export function extractRequirementsFromText(jobDescription: string): RequirementInput[] {
  const out: RequirementInput[] = [];
  const seen = new Set<string>();
  let section: 'REQUIRED' | 'PREFERRED' | 'DUTIES' | null = null;

  const push = (raw: string, category: 'REQUIRED' | 'PREFERRED' | undefined): void => {
    if (out.length >= MAX_REQUIREMENTS) return;
    let text = raw.replace(/\s+/g, ' ').replace(BULLET_RE, '').trim();
    if (text.length < 8) return;
    if (text.length > MAX_REQ_LENGTH) text = text.slice(0, MAX_REQ_LENGTH).trim();
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `req-${out.length + 1}`, text, ...(category ? { category } : {}) });
  };

  for (const line of jobDescription.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    if (isHeading(line)) {
      if (PREFERRED_HEADING_RE.test(line)) section = 'PREFERRED';
      else if (REQUIRED_HEADING_RE.test(line)) section = 'REQUIRED';
      else if (DUTIES_HEADING_RE.test(line)) section = 'DUTIES';
      else section = null;
      continue;
    }
    const isBullet = BULLET_RE.test(line);
    const pieces = isBullet ? [line] : line.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const piece of pieces) {
      const inlineCategory = PREFERRED_CUE_RE.test(piece)
        ? 'PREFERRED'
        : REQUIRED_CUE_RE.test(piece)
          ? 'REQUIRED'
          : undefined;
      if (isBullet) {
        const category =
          inlineCategory ?? (section === 'PREFERRED' ? 'PREFERRED' : section === 'REQUIRED' ? 'REQUIRED' : undefined);
        push(piece, category);
      } else if (REQUIREMENT_CUE_RE.test(piece) && (section !== null || inlineCategory)) {
        push(piece, inlineCategory ?? (section === 'PREFERRED' ? 'PREFERRED' : section === 'REQUIRED' ? 'REQUIRED' : undefined));
      } else if (REQUIREMENT_CUE_RE.test(piece) && /\b(you|candidate)\b/i.test(piece)) {
        push(piece, inlineCategory);
      }
    }
  }
  return out;
}
