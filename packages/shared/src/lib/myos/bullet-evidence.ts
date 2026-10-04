import { findUngroundedNumericClaims } from '../resume-tailoring-numeric-guard';
import type { EvidenceGraphData } from './graph-types';
import {
  bestEvidenceState,
  buildSupportIndex,
  isSolidState,
  verificationRank,
  type EvidenceRef,
  type SupportEntity,
  type SupportEntityType,
} from './match-requirements';
import { normalizeText, scoreTextMatch } from './text';

/**
 * Resume-bullet grounding helpers.
 *
 * GROUNDING SET: a bullet may only be grounded by entities that are approved for application use
 * (projects/experiences: userApproved AND approvedForApplications; achievements/stories:
 * userApproved) and whose own verification state is VERIFIED/USER_PROVIDED (for achievements and
 * stories). Evidence rows only count when their effective state (weaker of row and edge) is
 * VERIFIED/USER_PROVIDED. Entities directly related to a matched entity (an achievement of a matched
 * project, via `projectId`/graph edges) are part of the same grounding set. Anything else is
 * unsupported: numbers and technologies are flagged, never silently accepted.
 *
 * supportLevel (how well the bullet's *wording* is backed, independent of numbers):
 *  - STRONG   a grounding entity overlaps the bullet (score >= 0.5) and has solid evidence
 *  - MODERATE a grounding entity overlaps (>= 0.25) with solid evidence, or overlaps >= 0.5 with none
 *  - LIMITED  only unapproved / inferred / weakly overlapping candidates
 *  - NONE     nothing overlaps
 */

export type BulletSupportLevel = 'STRONG' | 'MODERATE' | 'LIMITED' | 'NONE';

const TECH_DISPLAY = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'Kotlin', 'Swift', 'Ruby', 'Rust', 'Golang',
  'PHP', 'Scala', 'SQL', 'PostgreSQL', 'Postgres', 'MySQL', 'MongoDB', 'Redis', 'SQLite',
  'DynamoDB', 'Firebase', 'Supabase', 'React', 'React Native', 'Next.js', 'Vue', 'Angular',
  'Svelte', 'Node.js', 'Express.js', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Ruby on Rails',
  'Laravel', 'GraphQL', 'Docker', 'Kubernetes', 'Terraform', 'AWS', 'Azure', 'GCP', 'Linux',
  'Git', 'GitHub Actions', 'Jenkins', 'Kafka', 'Spark', 'Hadoop', 'Airflow', 'Snowflake',
  'BigQuery', 'Tableau', 'Power BI', 'Excel', 'Figma', 'Jira', 'TensorFlow', 'PyTorch',
  'scikit-learn', 'Pandas', 'NumPy', 'OpenAI', 'LangChain', 'Tailwind', 'HTML', 'CSS', 'C++',
  'C#', '.NET', 'MATLAB', 'Flutter', 'Android', 'iOS', 'Webpack', 'Vite', 'Jest', 'Selenium',
  'Stripe', 'Twilio', 'Salesforce', 'HubSpot', 'Looker', 'dbt', 'Amplitude', 'Mixpanel', 'Notion',
  'Slack API', 'Heroku', 'Vercel', 'Netlify',
] as const;

function normalizeTech(s: string): string {
  return normalizeText(s).replace(
    /\b(node|next|express|vue|react|angular)\s?js\b/g,
    (_m, base: string) => (base === 'node' || base === 'next' || base === 'express' ? `${base}js` : base),
  );
}

const TECH_NORMALIZED = TECH_DISPLAY.map((d) => ({ display: d, norm: normalizeTech(d) }));

/** Common technology names mentioned in `text`, in list order (word-boundary matching). */
export function findTechNames(text: string): string[] {
  const hay = ` ${normalizeTech(text)} `;
  return TECH_NORMALIZED.filter((t) => hay.includes(` ${t.norm} `)).map((t) => t.display);
}

export interface BulletEvidenceMatch {
  entityType: SupportEntityType;
  entityId: string;
  name: string;
  score: number;
  matchedTerms: string[];
  /** True when the entity may ground a bullet (approved for applications and not merely inferred). */
  grounding: boolean;
  unconfirmed: boolean;
  evidence: EvidenceRef[];
}

export interface BulletEvidenceResult {
  matches: BulletEvidenceMatch[];
  supportLevel: BulletSupportLevel;
  whyThisBullet: string;
}

const MAX_MATCHES = 5;

function isGrounding(e: SupportEntity): boolean {
  if (!e.approvedForApplications) return false;
  return e.ownState === null || isSolidState(e.ownState);
}

function solidEvidence(e: SupportEntity): EvidenceRef[] {
  return e.evidence.filter((v) => isSolidState(v.verificationState));
}

function candidates(graph: EvidenceGraphData, bulletText: string) {
  const index = buildSupportIndex(graph);
  const out: { entity: SupportEntity; score: number; terms: string[] }[] = [];
  const bulletTech = new Set(findTechNames(bulletText).map(normalizeTech));
  for (const entity of index.entities) {
    const m = scoreTextMatch(bulletText, entity.text);
    // A linked skill named in the bullet is a text signal too.
    const skillHits = entity.skills
      .map((l) => index.skillById.get(l.skillId)?.name)
      .filter((n): n is string => !!n && bulletTech.has(normalizeTech(n)));
    const terms = [...m.matchedTerms, ...skillHits.map((s) => s.toLowerCase())];
    const score = Math.min(1, m.score + (skillHits.length > 0 ? 0.25 : 0));
    if (score >= 0.25 && terms.length > 0) out.push({ entity, score, terms: [...new Set(terms)] });
  }
  return { index, ranked: out };
}

function stateRank(e: SupportEntity): number {
  const s = bestEvidenceState(e);
  return s === null ? -1 : verificationRank(s);
}

export function findEvidenceForBullet(
  graph: EvidenceGraphData,
  bulletText: string,
): BulletEvidenceResult {
  const { ranked } = candidates(graph, bulletText);
  ranked.sort(
    (a, b) =>
      Number(isGrounding(b.entity)) - Number(isGrounding(a.entity)) ||
      stateRank(b.entity) - stateRank(a.entity) ||
      b.score - a.score ||
      a.entity.name.localeCompare(b.entity.name),
  );
  const top = ranked.slice(0, MAX_MATCHES);
  const matches: BulletEvidenceMatch[] = top.map(({ entity, score, terms }) => ({
    entityType: entity.entityType,
    entityId: entity.entityId,
    name: entity.name,
    score: Math.round(score * 100) / 100,
    matchedTerms: terms,
    grounding: isGrounding(entity),
    unconfirmed: !entity.approved,
    evidence: entity.evidence.map((v) => ({ ...v })),
  }));

  let supportLevel: BulletSupportLevel = 'NONE';
  if (ranked.length > 0) {
    supportLevel = 'LIMITED';
    for (const { entity, score } of ranked) {
      if (!isGrounding(entity)) continue;
      const solid = solidEvidence(entity).length > 0;
      if (solid && score >= 0.5) {
        supportLevel = 'STRONG';
        break;
      }
      if ((solid && score >= 0.25) || score >= 0.5) supportLevel = 'MODERATE';
    }
  }

  let why: string;
  if (matches.length === 0) {
    why = 'No project, experience, achievement or story in your profile supports this bullet.';
  } else {
    const first = matches[0]!;
    const kind = first.entityType.toLowerCase();
    const ev = first.evidence.find((v) => isSolidState(v.verificationState));
    why =
      `Best match: ${kind} "${first.name}" (overlap: ${first.matchedTerms.join(', ')}).` +
      (ev ? ` Evidence: ${ev.title} (${ev.verificationState.toLowerCase()}).` : ' It has no solid linked evidence.') +
      (first.grounding ? '' : ' This match is not approved for applications, so it cannot ground the bullet.');
  }
  return { matches, supportLevel, whyThisBullet: why };
}

export interface BulletCheckResult {
  ok: boolean;
  unsupportedNumbers: string[];
  unsupportedTechnologies: string[];
  supportLevel: BulletSupportLevel;
}

function flattenMetadata(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => flattenMetadata(v, out, depth + 1));
  else if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => flattenMetadata(v, out, depth + 1));
  }
}

export function checkBulletAgainstEvidence(
  graph: EvidenceGraphData,
  bulletText: string,
): BulletCheckResult {
  const { index, ranked } = candidates(graph, bulletText);
  const found = findEvidenceForBullet(graph, bulletText);

  // Grounding set: grounding candidates plus their directly related grounding entities.
  const set = new Map<string, SupportEntity>();
  for (const { entity } of ranked) {
    if (!isGrounding(entity)) continue;
    set.set(entity.key, entity);
    for (const key of entity.related) {
      const rel = index.byKey.get(key);
      if (rel && isGrounding(rel)) set.set(rel.key, rel);
    }
  }

  const evidenceById = new Map(graph.evidence.map((e) => [e.id, e]));
  const corpus: string[] = [];
  const skillNames = new Map(graph.skills.map((s) => [s.id, s]));
  for (const entity of set.values()) {
    corpus.push(entity.text);
    for (const link of entity.skills) {
      const sk = skillNames.get(link.skillId);
      if (sk?.userApproved && isSolidState(link.state)) corpus.push(sk.name);
    }
    for (const ref of solidEvidence(entity)) {
      const ev = evidenceById.get(ref.evidenceId);
      if (!ev) continue;
      corpus.push(ev.title);
      if (ev.excerpt) corpus.push(ev.excerpt);
      const meta: string[] = [];
      flattenMetadata(ev.metadata, meta);
      corpus.push(...meta);
    }
  }

  const unsupportedNumbers = findUngroundedNumericClaims(bulletText, corpus).map((c) => c.raw.trim());
  const hay = ` ${normalizeTech(corpus.join(' . '))} `;
  const unsupportedTechnologies = findTechNames(bulletText).filter(
    (t) => !hay.includes(` ${normalizeTech(t)} `),
  );

  return {
    ok:
      unsupportedNumbers.length === 0 &&
      unsupportedTechnologies.length === 0 &&
      found.supportLevel !== 'NONE',
    unsupportedNumbers,
    unsupportedTechnologies,
    supportLevel: found.supportLevel,
  };
}
