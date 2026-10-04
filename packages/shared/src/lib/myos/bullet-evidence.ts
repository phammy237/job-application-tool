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
import { findTechnologies } from './tech-dictionary';
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
 * NUMBER GROUNDING: a number in a bullet is grounded only by text the user authored or approved:
 * achievement metricText/description, project/experience/story text, user-authored evidence
 * title/excerpt. Repo-wide GitHub metadata (prCount, commitCount, stars, contributors) and GitHub
 * README/PR excerpts describe the repository, not the user, so they never ground a personal
 * number ("Authored 340 pull requests"). Beyond digits, spelled-out quantities ("doubled",
 * "fifty percent", "two-fold"), fullwidth digits and years used as counts ("2000 users") are
 * checked too.
 *
 * `ok` requires supportLevel STRONG or MODERATE: LIMITED (only unapproved / inferred / weakly
 * overlapping candidates) or NONE is never "ok", whatever the numbers look like.
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

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const NUMBER_WORD_RE = Object.keys(NUMBER_WORDS).join('|');
const QUANTITY_NOUNS =
  'users|customers|clients|people|engineers|employees|students|teams|requests|downloads|visitors|stars|sales|orders|accounts|developers|members|repos|repositories|pull requests|commits|contributors';

/** Spelled-out quantity claims: [claim text, acceptable equivalents in grounding text]. */
function spelledQuantityClaims(text: string): { claim: string; accepts: string[] }[] {
  const out: { claim: string; accepts: string[] }[] = [];
  const t = text.toLowerCase();
  const simple: [RegExp, string[]][] = [
    [/\b(doubl(?:ed|ing)|double)\b/g, ['doubl', '2x', 'two-fold', 'twofold', 'two fold', '100% increase']],
    [/\b(tripl(?:ed|ing)|triple)\b/g, ['tripl', '3x', 'three-fold', 'threefold', 'three fold']],
    [/\b(quadrupl(?:ed|ing)|quadruple)\b/g, ['quadrupl', '4x', 'four-fold', 'fourfold']],
    [/\b(halved|halving|half)\b/g, ['half', 'halv', '50%', 'fifty percent', '50 percent']],
  ];
  for (const [re, accepts] of simple) {
    for (const m of t.matchAll(re)) out.push({ claim: m[1]!, accepts });
  }
  const fold = new RegExp(`\\b(${NUMBER_WORD_RE}|\\d+)[\\s-]?(?:fold|times)\\b`, 'g');
  for (const m of t.matchAll(fold)) {
    const n = NUMBER_WORDS[m[1]!] ?? Number(m[1]);
    out.push({ claim: m[0], accepts: [m[0], `${n}x`, `${n}-fold`, `${n} fold`, `${n} times`, `${m[1]}-fold`, `${m[1]} fold`, `${m[1]} times`] });
  }
  const pct = new RegExp(`\\b(${NUMBER_WORD_RE})[\\s-]?(?:percent|per cent|percentage points?)`, 'g');
  for (const m of t.matchAll(pct)) {
    const n = NUMBER_WORDS[m[1]!]!;
    out.push({ claim: m[0], accepts: [m[0], `${n}%`, `${n} percent`, `${m[1]} percent`, `${m[1]} per cent`] });
  }
  const counted = new RegExp(`\\b(${NUMBER_WORD_RE})\\s+(?:${QUANTITY_NOUNS})\\b`, 'g');
  for (const m of t.matchAll(counted)) {
    const n = NUMBER_WORDS[m[1]!]!;
    const noun = m[0].slice(m[1]!.length).trim();
    out.push({ claim: m[0], accepts: [m[0], `${n} ${noun}`] });
  }
  // Years used as counts: "2000 users", "over 2024 requests".
  const yearCount = new RegExp(`\\b((?:19|20)\\d{2})\\s+(?:${QUANTITY_NOUNS})\\b`, 'g');
  for (const m of t.matchAll(yearCount)) out.push({ claim: m[0], accepts: [m[0]] });
  const yearAfter = /\b(?:over|under|about|around|approximately|nearly|more than|up to|~)\s*((?:19|20)\d{2})\b/g;
  for (const m of t.matchAll(yearAfter)) out.push({ claim: m[0], accepts: [m[0], m[1]!] });
  return out;
}

function ungroundedSpelled(bullet: string, corpusText: string): string[] {
  const hay = corpusText.toLowerCase();
  return spelledQuantityClaims(bullet)
    .filter((c) => !c.accepts.some((a) => hay.includes(a)))
    .map((c) => c.claim.trim());
}

/** Evidence text a user authored (never repo-wide GitHub metadata or fetched README/PR text). */
function userAuthoredEvidenceText(ev: { sourceType: string; title: string; excerpt: string | null }): string[] {
  const out = [ev.title];
  if (!ev.sourceType.startsWith('GITHUB_') && ev.excerpt) out.push(ev.excerpt);
  return out;
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
      // Metadata (prCount, commitCount, stars, contributors, ...) is deliberately not a source.
      corpus.push(...userAuthoredEvidenceText(ev));
    }
  }

  const nfkc = (v: string): string => v.normalize('NFKC');
  const bullet = nfkc(bulletText);
  const corpusN = corpus.map(nfkc);
  const unsupportedNumbers = [
    ...findUngroundedNumericClaims(bullet, corpusN).map((c) => c.raw.trim()),
    ...ungroundedSpelled(bullet, corpusN.join(' . ')),
  ];

  const corpusJoined = corpusN.join(' . ');
  const hay = ` ${normalizeTech(corpusJoined)} `;
  const corpusCanon = new Set(findTechnologies(corpusJoined).map((m) => m.canonical));
  const unsupportedTechnologies: string[] = [];
  const flaggedCanon = new Set<string>();
  for (const t of findTechNames(bullet)) {
    const canon = findTechnologies(t)[0]?.canonical;
    if (hay.includes(` ${normalizeTech(t)} `) || (canon && corpusCanon.has(canon))) continue;
    unsupportedTechnologies.push(t);
    if (canon) flaggedCanon.add(canon);
  }
  // Anything else in the technology dictionary that the grounding entities never mention.
  for (const m of findTechnologies(bullet)) {
    if (corpusCanon.has(m.canonical) || flaggedCanon.has(m.canonical)) continue;
    if (hay.includes(` ${normalizeTech(m.canonical)} `)) continue;
    if (unsupportedTechnologies.some((u) => normalizeTech(u) === normalizeTech(m.canonical))) continue;
    unsupportedTechnologies.push(m.canonical);
  }

  return {
    ok:
      unsupportedNumbers.length === 0 &&
      unsupportedTechnologies.length === 0 &&
      (found.supportLevel === 'STRONG' || found.supportLevel === 'MODERATE'),
    unsupportedNumbers,
    unsupportedTechnologies,
    supportLevel: found.supportLevel,
  };
}
