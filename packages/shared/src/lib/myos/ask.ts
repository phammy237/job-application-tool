import type { Competency, EvidenceSourceType, VerificationState } from '../../schemas/myos';
import { COMPETENCIES } from '../../schemas/myos';
import type { EvidenceGraphData } from './graph-types';
import {
  bestEvidenceState,
  buildSupportIndex,
  isSolidState,
  verificationRank,
  weakerState,
  type SupportEntity,
  type SupportEntityType,
  type SupportIndex,
} from './match-requirements';
import {
  competencyLabel,
  containsAllTokens,
  detectCompetencies,
  normalizeText,
  scoreTextMatch,
  tokenize,
} from './text';

/**
 * "Ask My ..." — deterministic, retrieval-only question answering over the evidence graph.
 *
 * GROUNDING BY CONSTRUCTION: the only way to add a claim is `makeClaim`, which throws when given no
 * support entries. Claim text is a fixed template filled with stored entity fields (names, titles,
 * skill names, metric text, evidence titles) — never free generation, never anything the graph
 * does not contain. The user's question only steers *retrieval*; its words are not echoed back as
 * facts. Stored text (descriptions etc.) is treated as plain data and is never interpreted.
 *
 * RANKING: user-approved entities first, then by best effective evidence state
 * VERIFIED > USER_PROVIDED > INFERRED/AI_GENERATED > none, then by lexical score. Inferred items are
 * labelled "inferred — confirm it"; unapproved items are labelled unconfirmed.
 */

export type AskIntent =
  | 'SKILL_EVIDENCE'
  | 'PROJECTS_FOR_TOPIC'
  | 'STORY_FOR_COMPETENCY'
  | 'INTERVIEW_PREP'
  | 'WEAK_AREAS'
  | 'GENERAL_SEARCH'
  | 'UNSUPPORTED';

export interface AskSupport {
  entityType: SupportEntityType | 'SKILL';
  entityId: string;
  label: string;
  evidence: {
    evidenceId: string;
    title: string;
    sourceType: EvidenceSourceType;
    sourceUrl: string | null;
    verificationState: VerificationState;
  }[];
}

export interface AskClaim {
  text: string;
  support: AskSupport[];
}

export interface AskAnswer {
  question: string;
  intent: AskIntent;
  answer: string;
  claims: AskClaim[];
  insufficientEvidence: boolean;
  notes: string[];
}

const MAX_CLAIMS = 6;
const MAX_EVIDENCE_PER_SUPPORT = 3;
const MIN_TOPIC_SCORE = 0.5;

/** Competencies a product-management conversation usually probes. */
export const PM_COMPETENCIES: readonly Competency[] = [
  'PRIORITIZATION',
  'CROSS_FUNCTIONAL_COLLABORATION',
  'USER_RESEARCH',
  'DATA_DRIVEN_DECISIONS',
  'OWNERSHIP',
  'EXECUTION',
  'LEADERSHIP',
];

const FRAME_WORDS = new Set(
  (
    'what which where who how when why show shows showed demonstrate demonstrates demonstrating ' +
    'project projects evidence best strongest biggest example examples story stories areas area ' +
    'profile have has had did do does can could should talk about tell me any some anything ' +
    'interview interviews prep prepare weak weakest most good strong used use using ' +
    'experience worked work any my i am is are the a an of in on for to with and or that'
  ).split(' '),
);

// --------------------------------------------------------------------------------------------
// Construction helpers
// --------------------------------------------------------------------------------------------

function supportFor(e: SupportEntity): AskSupport {
  return {
    entityType: e.entityType,
    entityId: e.entityId,
    label: e.name,
    evidence: e.evidence.slice(0, MAX_EVIDENCE_PER_SUPPORT).map((v) => ({
      evidenceId: v.evidenceId,
      title: v.title,
      sourceType: v.sourceType,
      sourceUrl: v.sourceUrl,
      verificationState: v.verificationState,
    })),
  };
}

/** The only way to create a claim. A claim without support is impossible. */
function makeClaim(text: string, support: AskSupport[]): AskClaim {
  if (support.length === 0 || text.trim().length === 0) {
    throw new Error('A claim must carry at least one support entry');
  }
  return { text, support };
}

const TYPE_WORD: Record<SupportEntityType, string> = {
  PROJECT: 'Project',
  EXPERIENCE: 'Experience',
  ACHIEVEMENT: 'Achievement',
  STORY: 'Story',
};

function stateOf(e: SupportEntity, edgeState?: VerificationState): VerificationState | null {
  const ev = bestEvidenceState(e);
  let best: VerificationState | null = ev;
  if (e.ownState && (best === null || verificationRank(e.ownState) > verificationRank(best))) {
    best = e.ownState;
  }
  if (best !== null && edgeState) best = weakerState(best, edgeState);
  return best;
}

function stateLabel(state: VerificationState | null, e: SupportEntity): string {
  switch (state) {
    case 'VERIFIED':
      return e.evidence[0] ? `verified, evidence: ${e.evidence[0].title}` : 'verified';
    case 'USER_PROVIDED':
      return e.evidence[0] ? `provided by you, evidence: ${e.evidence[0].title}` : 'provided by you';
    case 'INFERRED':
    case 'AI_GENERATED':
      return 'inferred — confirm it';
    default:
      return 'no linked evidence yet';
  }
}

type Via =
  | { kind: 'skill'; skillName: string; edgeState: VerificationState }
  | { kind: 'text'; terms: string[] }
  | { kind: 'competency'; competency: Competency };

interface Hit {
  entity: SupportEntity;
  via: Via;
  score: number;
  state: VerificationState | null;
}

function hitClaim(hit: Hit, skillSupport?: AskSupport): AskClaim {
  const e = hit.entity;
  let lead: string;
  switch (hit.via.kind) {
    case 'skill':
      lead = `${TYPE_WORD[e.entityType]} "${e.name}" uses ${hit.via.skillName}`;
      break;
    case 'competency':
      lead = `${TYPE_WORD[e.entityType]} "${e.name}" is tagged ${competencyLabel(hit.via.competency)}`;
      break;
    default:
      lead = `${TYPE_WORD[e.entityType]} "${e.name}" mentions ${hit.via.terms.join(', ')}`;
  }
  const metric = e.metric;
  const flag = e.approved ? '' : ' [unconfirmed: not yet approved by you]';
  const text = `${lead}${metric ? ` (metric: ${metric})` : ''} - ${stateLabel(hit.state, e)}.${flag}`;
  const support = [supportFor(e)];
  if (skillSupport) support.push(skillSupport);
  return makeClaim(text, support);
}

function rankHits(hits: Hit[]): Hit[] {
  return [...hits].sort(
    (a, b) =>
      Number(b.entity.approved) - Number(a.entity.approved) ||
      stateRank(b.state) - stateRank(a.state) ||
      b.score - a.score ||
      a.entity.name.localeCompare(b.entity.name),
  );
}

function stateRank(s: VerificationState | null): number {
  return s === null ? -1 : verificationRank(s);
}

// --------------------------------------------------------------------------------------------
// Intent detection & topic extraction
// --------------------------------------------------------------------------------------------

export function classifyQuestion(question: string): AskIntent {
  const q = question.trim().toLowerCase();
  if (q.length === 0 || /^(write|draft|generate|compose|rewrite|create|make)\b/.test(q)) {
    return 'UNSUPPORTED';
  }
  if (/\b(weak|weakest|weaknesses|gaps?|lacking|missing|improve|improvement)\b/.test(q)) {
    return 'WEAK_AREAS';
  }
  if (/\b(interview|interviews|prepare|prep)\b/.test(q)) return 'INTERVIEW_PREP';
  const comps = detectCompetencies(q);
  if (
    comps.length > 0 &&
    (/\b(strongest|best|biggest|favou?rite)\b.*\b(example|story|stories)\b/.test(q) ||
      /\bstory|stories|tell me about a time\b/.test(q))
  ) {
    return 'STORY_FOR_COMPETENCY';
  }
  if (/\bprojects?\b/.test(q)) return 'PROJECTS_FOR_TOPIC';
  if (/\b(where have i used|evidence|used|demonstrate|shows?|experience)\b/.test(q)) {
    return 'SKILL_EVIDENCE';
  }
  return 'GENERAL_SEARCH';
}

/** Question text with generic framing words removed; steers retrieval only. */
function topicQuery(question: string): string {
  return normalizeText(question)
    .split(' ')
    .filter((w) => w && !FRAME_WORDS.has(w))
    .join(' ');
}

// --------------------------------------------------------------------------------------------
// Retrieval
// --------------------------------------------------------------------------------------------

function topicalHits(
  index: SupportIndex,
  topic: string,
  competencies: Competency[],
  allowed: ReadonlySet<SupportEntityType>,
  storiesById: Map<string, Competency[]>,
): { hits: Hit[]; skillSupports: Map<string, AskSupport> } {
  const matchedSkills = [...index.skillById.values()].filter((s) => containsAllTokens(topic, s.name));
  const skillIds = new Map(matchedSkills.map((s) => [s.id, s.name]));
  const hits: Hit[] = [];
  const skillSupports = new Map<string, AskSupport>();

  for (const e of index.entities) {
    if (!allowed.has(e.entityType)) continue;
    const link = e.skills.find((l) => skillIds.has(l.skillId));
    if (link) {
      const name = skillIds.get(link.skillId)!;
      hits.push({
        entity: e,
        via: { kind: 'skill', skillName: name, edgeState: link.state },
        score: 1,
        state: stateOf(e, link.state),
      });
      skillSupports.set(e.key, { entityType: 'SKILL', entityId: link.skillId, label: name, evidence: [] });
      continue;
    }
    if (e.entityType === 'STORY') {
      const tags = storiesById.get(e.entityId) ?? [];
      const c = competencies.find((x) => tags.includes(x));
      if (c) {
        hits.push({ entity: e, via: { kind: 'competency', competency: c }, score: 1, state: stateOf(e) });
        continue;
      }
    }
    if (topic.length > 0) {
      const m = scoreTextMatch(topic, e.text);
      if (m.score >= MIN_TOPIC_SCORE && m.matchedTerms.length > 0) {
        hits.push({ entity: e, via: { kind: 'text', terms: m.matchedTerms }, score: m.score, state: stateOf(e) });
      }
    }
  }
  return { hits, skillSupports };
}

function insufficient(question: string, intent: AskIntent, answer: string, notes: string[]): AskAnswer {
  return { question, intent, answer, claims: [], insufficientEvidence: true, notes };
}

const ADD_DATA_NOTES = [
  'Add a project, skill, achievement or STAR story that covers this topic.',
  'Link evidence (a GitHub repo, README, document or note) so it can be cited.',
  'Approve imported items so they count as confirmed.',
];

function composeAnswer(intro: string, claims: AskClaim[], notes: string[]): string {
  const lines = [intro, ...claims.map((c) => `- ${c.text}`)];
  if (notes.length > 0) lines.push('Notes:', ...notes.map((n) => `- ${n}`));
  return lines.join('\n');
}

export function answerQuestion(graph: EvidenceGraphData, question: string, now: Date): AskAnswer {
  void now;
  const index = buildSupportIndex(graph);
  const storyTags = new Map(graph.stories.map((s) => [s.id, s.competencies]));
  const intent = classifyQuestion(question);
  const notes: string[] = [];

  if (intent === 'UNSUPPORTED') {
    return insufficient(
      question,
      intent,
      'I can only answer by retrieving facts stored in your profile; I cannot write or invent content.',
      ['Try asking what evidence you have for a skill, project, or competency.'],
    );
  }

  if (index.entities.length === 0 && graph.skills.length === 0) {
    return insufficient(question, intent, 'Your profile has no projects, stories, achievements or skills yet, so there is nothing to answer from.', ADD_DATA_NOTES);
  }

  if (intent === 'WEAK_AREAS') return answerWeakAreas(graph, index, question, notes);

  if (intent === 'INTERVIEW_PREP') return answerInterviewPrep(index, question, storyTags, notes);

  const topic = topicQuery(question);
  const competencies = detectCompetencies(question);
  const allowed = new Set<SupportEntityType>(
    intent === 'PROJECTS_FOR_TOPIC'
      ? ['PROJECT']
      : intent === 'STORY_FOR_COMPETENCY'
        ? ['STORY', 'ACHIEVEMENT']
        : ['PROJECT', 'EXPERIENCE', 'ACHIEVEMENT', 'STORY'],
  );

  if (topic.length === 0 && competencies.length === 0) {
    if (intent === 'PROJECTS_FOR_TOPIC') {
      const hits = rankHits(
        index.entities
          .filter((e) => e.entityType === 'PROJECT')
          .map((e): Hit => ({ entity: e, via: { kind: 'text', terms: ['your profile'] }, score: 0, state: stateOf(e) })),
      ).slice(0, MAX_CLAIMS);
      if (hits.length === 0) return insufficient(question, intent, 'No projects are stored in your profile.', ADD_DATA_NOTES);
      const claims = hits.map((h) =>
        makeClaim(
          `${TYPE_WORD.PROJECT} "${h.entity.name}" is in your profile - ${stateLabel(h.state, h.entity)}.${h.entity.approved ? '' : ' [unconfirmed: not yet approved by you]'}`,
          [supportFor(h.entity)],
        ),
      );
      return { question, intent, answer: composeAnswer('Projects stored in your profile, best-evidenced first:', claims, []), claims, insufficientEvidence: false, notes: [] };
    }
    return insufficient(question, 'GENERAL_SEARCH', 'I could not tell what topic to look up in your profile.', ['Name a skill, project topic or competency.']);
  }

  const { hits, skillSupports } = topicalHits(index, topic, competencies, allowed, storyTags);
  const achKind = new Map(graph.achievements.map((a) => [a.id, a.kind]));
  // Leadership-kind achievements count toward the LEADERSHIP competency.
  if (intent === 'STORY_FOR_COMPETENCY' && competencies.includes('LEADERSHIP')) {
    for (const e of index.entities) {
      if (e.entityType === 'ACHIEVEMENT' && achKind.get(e.entityId) === 'LEADERSHIP' && !hits.some((h) => h.entity.key === e.key)) {
        hits.push({ entity: e, via: { kind: 'competency', competency: 'LEADERSHIP' }, score: 1, state: stateOf(e) });
      }
    }
  }

  const ranked = rankHits(hits).slice(0, MAX_CLAIMS);
  if (ranked.length === 0) {
    return insufficient(question, intent, 'I found no evidence in your profile for that.', ADD_DATA_NOTES);
  }
  const claims = ranked.map((h) => hitClaim(h, skillSupports.get(h.entity.key)));
  if (ranked.some((h) => h.state === 'INFERRED' || h.state === 'AI_GENERATED')) {
    notes.push('Items marked "inferred — confirm it" were suggested, not confirmed; review them before relying on them.');
  }
  if (ranked.some((h) => !h.entity.approved)) {
    notes.push('Unconfirmed items have not been approved yet and are excluded from application use.');
  }
  if (ranked.every((h) => h.state === null)) {
    notes.push('None of these have linked evidence; add evidence to strengthen them.');
  }
  const intro =
    intent === 'STORY_FOR_COMPETENCY'
      ? 'Best matching stories and achievements in your profile, strongest first:'
      : 'Here is what your stored profile shows, strongest evidence first:';
  return { question, intent, answer: composeAnswer(intro, claims, notes), claims, insufficientEvidence: false, notes };
}

function answerInterviewPrep(
  index: SupportIndex,
  question: string,
  storyTags: Map<string, Competency[]>,
  notes: string[],
): AskAnswer {
  const asked = detectCompetencies(question);
  const isPm = tokenize(question).includes('g_product_management');
  // The company name is only context: it is never matched against, or echoed from, the graph.
  const comps: Competency[] = isPm
    ? [...new Set([...asked, ...PM_COMPETENCIES])]
    : asked.length > 0
      ? asked
      : ['OWNERSHIP', 'LEADERSHIP', 'EXECUTION', 'AMBIGUITY'];

  const claims: AskClaim[] = [];
  const noStory: Competency[] = [];
  for (const c of comps) {
    const stories = rankHits(
      index.entities
        .filter((e) => e.entityType === 'STORY' && (storyTags.get(e.entityId) ?? []).includes(c))
        .map((e): Hit => ({ entity: e, via: { kind: 'competency', competency: c }, score: 1, state: stateOf(e) })),
    );
    const best = stories[0];
    if (!best) {
      noStory.push(c);
      continue;
    }
    claims.push(
      makeClaim(
        `For ${competencyLabel(c)}: your story "${best.entity.name}" - ${stateLabel(best.state, best.entity)}.${best.entity.approved ? '' : ' [unconfirmed: not yet approved by you]'}`,
        [supportFor(best.entity)],
      ),
    );
    if (claims.length >= MAX_CLAIMS) break;
  }
  if (isPm && claims.length < MAX_CLAIMS) {
    const pm = rankHits(
      index.entities
        .filter((e) => e.entityType === 'PROJECT')
        .map((e): Hit | null => {
          const m = scoreTextMatch('product management', e.text);
          return m.conceptMatch ? { entity: e, via: { kind: 'text', terms: m.matchedTerms }, score: m.score, state: stateOf(e) } : null;
        })
        .filter((h): h is Hit => h !== null),
    ).slice(0, MAX_CLAIMS - claims.length);
    for (const h of pm) claims.push(hitClaim(h));
  }
  for (const c of noStory) notes.push(`No story in your profile is tagged ${competencyLabel(c)}; consider writing one.`);
  if (claims.length === 0) {
    return insufficient(question, 'INTERVIEW_PREP', 'I found no stories or projects in your profile to prepare from.', [
      ...ADD_DATA_NOTES,
      ...notes,
    ]);
  }
  return {
    question,
    intent: 'INTERVIEW_PREP',
    answer: composeAnswer('Things from your profile you could talk about, by competency:', claims, notes),
    claims,
    insufficientEvidence: false,
    notes,
  };
}

function answerWeakAreas(
  graph: EvidenceGraphData,
  index: SupportIndex,
  question: string,
  notes: string[],
): AskAnswer {
  const claims: AskClaim[] = [];
  const linkedSkills = new Set(index.entities.flatMap((e) => e.skills.map((s) => s.skillId)));
  for (const s of graph.skills) {
    if (!linkedSkills.has(s.id) && claims.length < MAX_CLAIMS) {
      claims.push(makeClaim(`Skill "${s.name}" is listed but no project, experience or story uses it.`, [
        { entityType: 'SKILL', entityId: s.id, label: s.name, evidence: [] },
      ]));
    }
  }
  for (const e of index.entities) {
    if (claims.length >= MAX_CLAIMS) break;
    if (e.entityType !== 'PROJECT' && e.entityType !== 'EXPERIENCE') continue;
    const best = bestEvidenceState(e);
    if (best === null) {
      claims.push(makeClaim(`${TYPE_WORD[e.entityType]} "${e.name}" has no linked evidence.`, [supportFor(e)]));
    } else if (!isSolidState(best)) {
      claims.push(makeClaim(`${TYPE_WORD[e.entityType]} "${e.name}" only has inferred evidence — confirm it.`, [supportFor(e)]));
    } else if (!e.approved) {
      claims.push(makeClaim(`${TYPE_WORD[e.entityType]} "${e.name}" is not approved yet.`, [supportFor(e)]));
    }
  }
  const covered = new Set<Competency>();
  for (const s of graph.stories) if (s.userApproved) s.competencies.forEach((c) => covered.add(c));
  const missing = COMPETENCIES.filter((c) => !covered.has(c));
  if (missing.length > 0) {
    notes.push(`No approved story is tagged: ${missing.map(competencyLabel).join(', ')}.`);
  }
  if (claims.length === 0 && missing.length === 0) {
    return insufficient(question, 'WEAK_AREAS', 'I found no weak areas in the stored profile.', []);
  }
  const intro = 'Weak spots found in your stored profile:';
  if (claims.length === 0) {
    return { question, intent: 'WEAK_AREAS', answer: composeAnswer(intro, claims, notes), claims, insufficientEvidence: true, notes: [...notes, ...ADD_DATA_NOTES] };
  }
  return { question, intent: 'WEAK_AREAS', answer: composeAnswer(intro, claims, notes), claims, insufficientEvidence: false, notes };
}
