import { COMPETENCIES, type Competency } from '../../schemas/myos';

/**
 * Tiny, dependency-free text helpers shared by the myOS retrieval modules (requirement matching,
 * Ask, interview prep, bullet grounding). Everything here is deterministic and pure.
 *
 * The matching is intentionally lexical: normalise, fold career-vocabulary synonyms into one
 * canonical token, drop stopwords, stem lightly, then compare token sets. It never "understands"
 * text — it can only report that words overlap — so callers must treat a text match as weak
 * evidence (see match-requirements.ts).
 */

export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a an and are as at be but by for from has have how i in into is it its of on or our that the ' +
    'their them this to was we were what when where which who whom why will with within you your ' +
    'my me do does did can could should would about across over under using use used via per ' +
    // job-description filler that carries no topical signal
    'experience experienced years year ability able strong strongly proven demonstrated ' +
    'excellent good great skills skill knowledge understanding familiarity proficiency ' +
    'proficient required preferred plus bonus must nice ideal candidate role team work working ' +
    'including include etc related relevant least minimum looking seeking responsible'
  ).split(/\s+/),
);

/** Groups of terms that mean the same thing in career vocabulary. Longest phrases are applied first. */
export interface SynonymGroup {
  canonical: string;
  terms: readonly string[];
}

export const SYNONYM_GROUPS: readonly SynonymGroup[] = [
  {
    canonical: 'product management',
    terms: ['product management', 'product manager', 'product managers', 'pm', 'pms'],
  },
  {
    canonical: 'user research',
    terms: [
      'user research',
      'customer interviews',
      'customer interview',
      'user interviews',
      'user interview',
      'customer research',
      'ux research',
      'usability testing',
      'usability',
    ],
  },
  {
    canonical: 'cross functional',
    terms: [
      'cross functionally',
      'cross functional',
      'crossfunctional',
      'stakeholder management',
      'stakeholders',
      'stakeholder',
    ],
  },
  {
    // SQL is a tool, not a synonym of analytics: see RELATED_CONCEPTS.
    canonical: 'data analysis',
    terms: ['data analysis', 'data analytics', 'analytics'],
  },
  { canonical: 'artificial intelligence', terms: ['artificial intelligence', 'ai'] },
  { canonical: 'machine learning', terms: ['machine learning', 'ml'] },
  {
    canonical: 'large language models',
    terms: ['large language models', 'large language model', 'llms', 'llm'],
  },
  { canonical: 'generative ai', terms: ['generative ai', 'gen ai', 'genai'] },
  { canonical: 'roadmap', terms: ['product roadmap', 'roadmapping', 'roadmap'] },
  {
    canonical: 'experimentation',
    terms: ['a b testing', 'a b test', 'ab testing', 'experimentation', 'experiments'],
  },
  {
    canonical: 'prioritization',
    terms: [
      'prioritization',
      'prioritisation',
      'prioritizing',
      'prioritize',
      'prioritise',
    ],
  },
  { canonical: 'leadership', terms: ['leadership', 'leading', 'led', 'lead'] },
];

/**
 * RELATED (not identical) concepts, ASYMMETRIC: key = a concept token wanted by the query (a job
 * requirement); value = tokens that are merely related to it. A related match is never as good as
 * an exact/synonym match: matching code must cap it at LIMITED and say "related, not identical".
 * Tokens are canonical `g_...` group tokens or plain stemmed words.
 */
export const RELATED_CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  g_large_language_models: [
    'g_machine_learning',
    'g_artificial_intelligence',
    'g_generative_ai',
  ],
  g_generative_ai: [
    'g_machine_learning',
    'g_artificial_intelligence',
    'g_large_language_models',
  ],
  g_artificial_intelligence: [
    'g_machine_learning',
    'g_large_language_models',
    'g_generative_ai',
  ],
  g_machine_learning: ['g_artificial_intelligence', 'g_large_language_models'],
  g_data_analysis: ['sql'],
};

/**
 * Keyword rules mapping free text to the story competencies (also used on job descriptions).
 * A trailing "~" means "prefix match" (e.g. "prioritiz~" matches "prioritizing").
 */
export const COMPETENCY_KEYWORDS: Record<Competency, readonly string[]> = {
  LEADERSHIP: ['leadership', 'led', 'lead', 'leading', 'mentor~', 'manage a team'],
  CONFLICT: ['conflict', 'disagreement', 'influence without authority', 'negotiat~'],
  AMBIGUITY: [
    'ambiguity',
    'ambiguous',
    'undefined',
    'zero to one',
    '0 to 1',
    'fast paced',
  ],
  FAILURE: ['failure', 'failed', 'mistake', 'lessons learned', 'resilience'],
  TECHNICAL_DECISION_MAKING: [
    'technical decision',
    'architecture',
    'trade off',
    'tradeoff',
    'technical',
    'engineering',
    'system design',
  ],
  USER_RESEARCH: [
    'user research',
    'customer interview',
    'usability',
    'customer insight',
    'voice of the customer',
    'user feedback',
    'ux research',
  ],
  PRIORITIZATION: [
    'prioritiz~',
    'prioritis~',
    'roadmap',
    'trade off',
    'tradeoff',
    'backlog',
  ],
  CROSS_FUNCTIONAL_COLLABORATION: [
    'cross functional~',
    'stakeholder~',
    'partner with',
    'collaborat~',
    'engineering and design',
  ],
  DATA_DRIVEN_DECISIONS: [
    'data driven',
    'metrics',
    'analytics',
    'experiment~',
    'a b test~',
    'kpi',
    'sql',
    'data analysis',
  ],
  OWNERSHIP: ['ownership', 'own the', 'end to end', 'accountab~', 'self starter'],
  EXECUTION: [
    'execution',
    'deliver~',
    'ship~',
    'launch~',
    'deadline',
    'program management',
  ],
};

const COMPETENCY_LABELS: Record<Competency, string> = {
  LEADERSHIP: 'leadership',
  CONFLICT: 'handling conflict',
  AMBIGUITY: 'navigating ambiguity',
  FAILURE: 'learning from failure',
  TECHNICAL_DECISION_MAKING: 'technical decision-making',
  USER_RESEARCH: 'user research',
  PRIORITIZATION: 'prioritization',
  CROSS_FUNCTIONAL_COLLABORATION: 'cross-functional collaboration',
  DATA_DRIVEN_DECISIONS: 'data-driven decisions',
  OWNERSHIP: 'ownership',
  EXECUTION: 'execution',
};

export function competencyLabel(c: Competency): string {
  return COMPETENCY_LABELS[c];
}

/** Lowercase, fold a few symbol-heavy tech names, turn punctuation into spaces. */
export function normalizeText(input: string): string {
  let s = input.toLowerCase();
  s = s
    .replace(/c\+\+/g, 'cplusplus')
    .replace(/c#/g, 'csharp')
    .replace(/node\.js/g, 'nodejs')
    .replace(/next\.js/g, 'nextjs')
    .replace(/\.net\b/g, 'dotnet')
    .replace(/\ba\/b\b/g, 'a b');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Very conservative suffix stripping so "projects"/"project", "launched"/"launch" line up. */
export function stemLite(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (/(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

const CANON_PREFIX = 'g_';

const SORTED_TERMS: { term: string; token: string }[] = SYNONYM_GROUPS.flatMap((g) =>
  g.terms.map((t) => ({
    term: normalizeText(t),
    token: CANON_PREFIX + g.canonical.replace(/ /g, '_'),
  })),
).sort((a, b) => b.term.length - a.term.length);

/** Normalised text with every synonym-group phrase replaced by its canonical `g_...` token. */
export function canonicalize(input: string): string {
  let s = ` ${normalizeText(input)} `;
  for (const { term, token } of SORTED_TERMS) {
    const needle = ` ${term} `;
    // two passes: adjacent matches share their separating space
    s = s.split(needle).join(` ${token} `);
    s = s.split(needle).join(` ${token} `);
  }
  return s.trim();
}

/** Canonical, stopword-free, stemmed tokens (duplicates removed, order preserved). */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of canonicalize(input).split(' ')) {
    if (!raw) continue;
    let tok = raw;
    if (!tok.startsWith(CANON_PREFIX)) {
      if (STOPWORDS.has(tok)) continue;
      if (tok.length < 2) continue;
      if (/^\d+$/.test(tok)) continue;
      tok = stemLite(tok);
    }
    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

export function tokenLabel(token: string): string {
  return token.startsWith(CANON_PREFIX)
    ? token.slice(CANON_PREFIX.length).replace(/_/g, ' ')
    : token;
}

export interface TextMatch {
  /** 0..1 — weighted share of the query's tokens found in the text. */
  score: number;
  matchedTerms: string[];
  /** True when at least one canonical concept (synonym group) matched exactly. */
  conceptMatch: boolean;
  /** Query concepts satisfied only by a merely RELATED concept (opt-in; see RELATED_CONCEPTS). */
  relatedConcepts: string[];
}

export interface ScoreOptions {
  /** Give half credit to RELATED_CONCEPTS (never counts as an exact concept match). */
  allowRelated?: boolean;
}

/** Concept tokens count double so "product management" outweighs incidental words. */
export function scoreTextMatch(
  query: string,
  text: string,
  options: ScoreOptions = {},
): TextMatch {
  const q = tokenize(query);
  if (q.length === 0)
    return { score: 0, matchedTerms: [], conceptMatch: false, relatedConcepts: [] };
  return scoreTokenMatch(q, new Set(tokenize(text)), options);
}

/**
 * `scoreTextMatch` over already-tokenized input (`q` = tokenize(query), `t` = set of
 * tokenize(text)), so hot loops can tokenize each text once instead of once per comparison.
 */
export function scoreTokenMatch(
  q: readonly string[],
  t: ReadonlySet<string>,
  options: ScoreOptions = {},
): TextMatch {
  if (q.length === 0)
    return { score: 0, matchedTerms: [], conceptMatch: false, relatedConcepts: [] };
  let total = 0;
  let hit = 0;
  const matched: string[] = [];
  let conceptMatch = false;
  const related: string[] = [];
  for (const tok of q) {
    const w = tok.startsWith(CANON_PREFIX) ? 2 : 1;
    total += w;
    if (t.has(tok)) {
      hit += w;
      matched.push(tokenLabel(tok));
      if (w === 2) conceptMatch = true;
    } else if (
      options.allowRelated &&
      (RELATED_CONCEPTS[tok] ?? []).some((r) => t.has(r))
    ) {
      hit += w / 2;
      related.push(tokenLabel(tok));
    }
  }
  return {
    score: total === 0 ? 0 : hit / total,
    matchedTerms: matched,
    conceptMatch,
    relatedConcepts: related,
  };
}

/** True when every token of `phrase` (after canonicalisation) appears in `text`. Empty phrases never match. */
export function containsAllTokens(text: string, phrase: string): boolean {
  const p = tokenize(phrase);
  if (p.length === 0) return false;
  const t = new Set(tokenize(text));
  return p.every((tok) => t.has(tok));
}

/**
 * Like containsAllTokens(text, phrase) but also accepts RELATED concepts: returns 'exact' when
 * every phrase token is in `text`, 'related' when every token is present or related to a token of
 * `text` (at least one only related), else null. `text` is the requirement, `phrase` the
 * skill name; the relation is looked up from the requirement's concept (asymmetric).
 */
export function matchTokensWithRelated(
  text: string,
  phrase: string,
): 'exact' | 'related' | null {
  return matchTokenSetsWithRelated(new Set(tokenize(text)), tokenize(phrase));
}

/** `matchTokensWithRelated` over already-tokenized input (`t` from the text, `p` from the phrase). */
export function matchTokenSetsWithRelated(
  t: ReadonlySet<string>,
  p: readonly string[],
): 'exact' | 'related' | null {
  if (p.length === 0) return null;
  if (p.every((tok) => t.has(tok))) return 'exact';
  const relatedToPhrase = new Set<string>();
  for (const req of t)
    for (const r of RELATED_CONCEPTS[req] ?? []) relatedToPhrase.add(r);
  return p.every((tok) => t.has(tok) || relatedToPhrase.has(tok)) ? 'related' : null;
}

/** Competencies whose keyword rules fire on `text`. */
export function detectCompetencies(text: string): Competency[] {
  const n = ` ${normalizeText(text)} `;
  return COMPETENCY_NEEDLES.filter(({ needles }) =>
    needles.some((k) => n.includes(k)),
  ).map(({ competency }) => competency);
}

/** Keyword rules normalised once at module load: " kw " (whole words) or " kw" (prefix, "~"). */
const COMPETENCY_NEEDLES: { competency: Competency; needles: string[] }[] =
  COMPETENCIES.map((competency) => ({
    competency,
    needles: COMPETENCY_KEYWORDS[competency].map((k) =>
      k.endsWith('~') ? ` ${normalizeText(k)}` : ` ${normalizeText(k)} `,
    ),
  }));
