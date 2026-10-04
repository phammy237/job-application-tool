import {
  findTechnologies,
  type EvidenceGraphData,
  type MyosEvidence,
  type RankedSkillStrength,
  type SkillStrengthLevel,
  type VerificationState,
} from '@career-os/shared';
import { z } from 'zod';

export type SkillSort = 'strength' | 'recency' | 'name';

export interface SkillListParams {
  q: string;
  category: string;
  sort: SkillSort;
}

const LEVEL_RANK: Record<SkillStrengthLevel, number> = {
  NONE: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export function parseSkillListParams(
  sp: Record<string, string | string[] | undefined>,
): SkillListParams {
  const sortRaw = first(sp.sort);
  const sort: SkillSort = sortRaw === 'recency' || sortRaw === 'name' ? sortRaw : 'strength';
  return { q: first(sp.q).trim().slice(0, 100), category: first(sp.category).trim(), sort };
}

export function filterSortSkills(
  rows: readonly RankedSkillStrength[],
  params: SkillListParams,
): RankedSkillStrength[] {
  const q = params.q.toLowerCase();
  const filtered = rows.filter(({ skill }) => {
    if (q && !skill.name.toLowerCase().includes(q)) return false;
    if (params.category) {
      if (params.category === '__none__') return !skill.category;
      if (skill.category !== params.category) return false;
    }
    return true;
  });
  const byName = (a: RankedSkillStrength, b: RankedSkillStrength) =>
    a.skill.name.localeCompare(b.skill.name);
  return [...filtered].sort((a, b) => {
    if (params.sort === 'name') return byName(a, b);
    if (params.sort === 'recency') {
      return (
        (a.strength.monthsSinceLatest ?? Infinity) - (b.strength.monthsSinceLatest ?? Infinity) ||
        byName(a, b)
      );
    }
    return (
      LEVEL_RANK[b.strength.level] - LEVEL_RANK[a.strength.level] ||
      b.strength.verifiedEvidenceCount - a.strength.verifiedEvidenceCount ||
      byName(a, b)
    );
  });
}

export function recencyLabel(
  recency: 'CURRENT' | 'RECENT' | 'DATED' | 'UNKNOWN',
  latestActivity: string | null,
): string {
  const when = latestActivity ? ` (${latestActivity.slice(0, 7)})` : '';
  switch (recency) {
    case 'CURRENT':
      return `Current${when}`;
    case 'RECENT':
      return `Recent${when}`;
    case 'DATED':
      return `Dated${when}`;
    default:
      return 'No dated activity';
  }
}

export function qualityLabel(quality: 'VERIFIED' | 'MIXED' | 'UNVERIFIED' | 'NONE'): string {
  switch (quality) {
    case 'VERIFIED':
      return 'All evidence verified';
    case 'MIXED':
      return 'Some evidence verified';
    case 'UNVERIFIED':
      return 'Evidence not yet verified';
    default:
      return 'No evidence';
  }
}

export interface SkillEvidenceItem {
  evidence: MyosEvidence;
  /** State of the SUPPORTS link itself (who asserted that this evidence supports the skill). */
  linkState: VerificationState;
  /** True when the evidence is VERIFIED and the link is confirmed by the user. */
  countsAsVerified: boolean;
}

/** Evidence supporting a skill directly or through one of its supporting entities. */
export function skillEvidenceItems(
  graph: Pick<EvidenceGraphData, 'edges' | 'evidence'>,
  skillId: string,
  supportingEntityIds: readonly string[],
): SkillEvidenceItem[] {
  const anchors = new Set([skillId, ...supportingEntityIds]);
  const byId = new Map(graph.evidence.map((e) => [e.id, e]));
  const out = new Map<string, SkillEvidenceItem>();
  for (const edge of graph.edges) {
    if (edge.relation !== 'SUPPORTS' || edge.fromType !== 'EVIDENCE') continue;
    if (!anchors.has(edge.toId)) continue;
    const evidence = byId.get(edge.fromId);
    if (!evidence) continue;
    const confirmed = edge.verificationState === 'VERIFIED' || edge.verificationState === 'USER_PROVIDED';
    const counts = evidence.verificationState === 'VERIFIED' && confirmed;
    const prev = out.get(evidence.id);
    if (!prev || (counts && !prev.countsAsVerified)) {
      out.set(evidence.id, {
        evidence,
        linkState: edge.verificationState,
        countsAsVerified: counts,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.evidence.title.localeCompare(b.evidence.title));
}

export interface TechSuggestion {
  name: string;
  category: string;
  /** Names of the projects/experiences whose text mentioned it. */
  sources: string[];
}

/**
 * Technologies mentioned in project/experience text or tags that have no skill row yet. These
 * are INFERRED suggestions only — nothing is created until the user clicks Add.
 */
export function detectMissingTechnologies(
  graph: Pick<EvidenceGraphData, 'projects' | 'experiences' | 'skills'>,
): TechSuggestion[] {
  const existing = new Set(graph.skills.map((s) => s.name.trim().toLowerCase()));
  const found = new Map<string, TechSuggestion>();
  const scan = (label: string, parts: Array<string | null | undefined>, tags: string[]) => {
    const text = [...parts, ...tags].filter(Boolean).join('\n');
    for (const match of findTechnologies(text)) {
      const key = match.canonical.toLowerCase();
      if (existing.has(key)) continue;
      const hit = found.get(key);
      if (hit) {
        if (!hit.sources.includes(label)) hit.sources.push(label);
      } else {
        found.set(key, { name: match.canonical, category: match.category, sources: [label] });
      }
    }
  };
  for (const p of graph.projects) scan(p.name, [p.description, p.summary], p.tags);
  for (const e of graph.experiences) scan(`${e.title} at ${e.company}`, [e.description], e.tags);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function categoryLabel(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const addSkillFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a skill name.').max(100, 'Skill name is too long.'),
  category: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const linkSkillFormSchema = z.object({
  skillId: z.string().uuid(),
  target: z
    .string()
    .regex(/^(PROJECT|EXPERIENCE):[0-9a-fA-F-]{36}$/, 'Choose a project or experience.'),
});

export function parseLinkTarget(target: string): { type: 'PROJECT' | 'EXPERIENCE'; id: string } {
  const [type, id] = target.split(':') as ['PROJECT' | 'EXPERIENCE', string];
  return { type, id };
}
