import type { Competency, MyosCandidateInput } from '../../schemas/myos';
import {
  findTechnologies,
  skillAreasFor,
  techEntryFor,
  type TechCategory,
  type TechEntry,
} from './tech-dictionary';

/**
 * Deterministic candidate extraction from a synced GitHub repository snapshot.
 *
 * Hard rules (this is the anti-hallucination boundary for repo ingestion):
 *  - Candidates are INFERRED suggestions; callers store them as PENDING. Nothing here is a fact
 *    the user has approved.
 *  - Every talking point is a fixed template filled ONLY with observed values from the input
 *    (language shares, README technology mentions, topics, counts). No metrics, roles, awards,
 *    outcomes, or impact claims are ever produced, and no number appears that is not in the input
 *    (or a direct count/percentage of it).
 *  - Project summaries are verbatim excerpts (markup stripped), never paraphrases.
 *  - Competencies only from explicit README/description phrases.
 *  - Every candidate names its exact source signal in `rationale` and has a stable dedupeKey.
 */

export interface RepositoryLike {
  fullName: string;
  description: string | null;
  primaryLanguage: string | null;
  languages: Record<string, number>;
  topics: string[];
  readmeExcerpt: string | null;
  prCount: number;
  contributors: Array<{ login: string; contributions: number }>;
}

export const MIN_LANGUAGE_SHARE = 0.05;
const SUMMARY_MAX_CHARS = 400;
const MAX_README_TECH_IN_TALKING_POINT = 5;

const CATEGORY_LABEL: Record<TechCategory, string> = {
  LANGUAGE: 'Programming language',
  FRAMEWORK: 'Framework',
  DATABASE: 'Database',
  CLOUD: 'Cloud',
  TOOL: 'Tool',
  AI_ML: 'AI/ML',
  PRACTICE: 'Practice',
};

/** GitHub language names that are not dictionary names. */
const LANGUAGE_ALIASES: Record<string, string> = {
  shell: 'Bash',
  dockerfile: 'Docker',
  'jupyter notebook': 'Jupyter',
};

const COMPETENCY_PHRASES: Array<{ competency: Competency; phrases: string[] }> = [
  {
    competency: 'USER_RESEARCH',
    phrases: ['user research', 'user interviews', 'usability testing'],
  },
  { competency: 'DATA_DRIVEN_DECISIONS', phrases: ['data-driven', 'data driven'] },
  {
    competency: 'CROSS_FUNCTIONAL_COLLABORATION',
    phrases: ['cross-functional', 'cross functional'],
  },
  { competency: 'PRIORITIZATION', phrases: ['prioritization', 'prioritisation'] },
];

export function slugForKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function cap(s: string, n = 1000): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function resolveLanguage(name: string): TechEntry | undefined {
  return (
    techEntryFor(name) ??
    (LANGUAGE_ALIASES[name.toLowerCase()]
      ? techEntryFor(LANGUAGE_ALIASES[name.toLowerCase()]!)
      : undefined) ??
    (() => {
      const m = findTechnologies(name)[0];
      return m ? techEntryFor(m.canonical) : undefined;
    })()
  );
}

/** First substantive README paragraph with markdown/HTML decoration removed; null if none. */
export function firstReadmeParagraph(readme: string | null): string | null {
  if (!readme) return null;
  const blocks = readme.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const cleaned = block
      .split('\n')
      .filter((line) => !/^\s*(#{1,6}\s|[-*_=]{3,}\s*$|```|>|\|)/.test(line))
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 30 && /[A-Za-z]{3,}/.test(cleaned)) return cleaned;
  }
  return null;
}

function excerpt(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const slice = text.slice(0, SUMMARY_MAX_CHARS);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (sentenceEnd > SUMMARY_MAX_CHARS * 0.5) return slice.slice(0, sentenceEnd + 1);
  const space = slice.lastIndexOf(' ');
  return `${slice.slice(0, space > 0 ? space : SUMMARY_MAX_CHARS)}…`;
}

export function extractCandidatesFromRepository(
  repo: RepositoryLike,
  evidenceIds: string[],
  projectId: string | null = null,
): MyosCandidateInput[] {
  const scope = projectId ?? repo.fullName;
  const out: MyosCandidateInput[] = [];
  const skillNames = new Set<string>();
  const detected: string[] = []; // canonical names, in discovery order
  const make = (
    payload: MyosCandidateInput['payload'],
    rationale: string,
    dedupeKey: string,
  ): void => {
    out.push({
      projectId,
      payload,
      evidenceIds: [...evidenceIds],
      rationale: cap(rationale),
      dedupeKey,
    });
  };
  const addSkill = (entry: TechEntry, rationale: string): void => {
    if (!detected.includes(entry.canonical)) detected.push(entry.canonical);
    if (skillNames.has(entry.canonical)) return;
    skillNames.add(entry.canonical);
    make(
      { kind: 'SKILL', skill: entry.canonical, category: CATEGORY_LABEL[entry.category] },
      rationale,
      `skill:${slugForKey(entry.canonical)}:${scope}`,
    );
  };

  // 1. Languages by byte share.
  const totalBytes = Object.values(repo.languages).reduce(
    (s, n) => s + (n > 0 ? n : 0),
    0,
  );
  const shares = new Map<string, number>();
  if (totalBytes > 0) {
    const entries = Object.entries(repo.languages)
      .filter(([, bytes]) => bytes > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [name, bytes] of entries) {
      const share = bytes / totalBytes;
      shares.set(name, share);
      if (share < MIN_LANGUAGE_SHARE) continue;
      const entry = resolveLanguage(name);
      if (!entry) continue;
      addSkill(
        entry,
        `GitHub language statistics for ${repo.fullName}: ${name} is ${Math.round(share * 100)}% of the code`,
      );
    }
  }

  // 2. Topics.
  for (const topic of repo.topics) {
    const normalized = topic.replace(/[-_]+/g, ' ');
    const entry =
      techEntryFor(normalized) ??
      (() => {
        const m = findTechnologies(normalized)[0];
        return m ? techEntryFor(m.canonical) : undefined;
      })();
    if (entry) addSkill(entry, `GitHub topic "${topic}" on ${repo.fullName}`);
  }

  // 3. README technology mentions.
  const readme = repo.readmeExcerpt ?? '';
  const readmeTech = findTechnologies(readme);
  for (const m of readmeTech) {
    const entry = techEntryFor(m.canonical);
    if (entry)
      addSkill(
        entry,
        `Mentioned as "${m.matchedAlias}" in the README of ${repo.fullName}`,
      );
  }

  // 4. Broader skill areas implied by detected technologies.
  const areaSources = new Map<string, string[]>();
  for (const canonical of detected) {
    for (const area of skillAreasFor(canonical)) {
      const list = areaSources.get(area) ?? [];
      list.push(canonical);
      areaSources.set(area, list);
    }
  }
  for (const [area, sources] of [...areaSources.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (skillNames.has(area)) continue;
    skillNames.add(area);
    make(
      { kind: 'SKILL', skill: area, category: 'Skill area' },
      `Implied by detected technologies in ${repo.fullName}: ${joinList(sources.slice(0, 4))}`,
      `skill:${slugForKey(area)}:${scope}`,
    );
  }

  // 5. Talking points (fixed templates over observed facts only).
  // "Built with" only for things one builds with; practices (user research, agile) are skipped.
  const builtWith = readmeTech.filter((m) => m.category !== 'PRACTICE');
  if (builtWith.length > 0) {
    const names = builtWith
      .slice(0, MAX_README_TECH_IN_TALKING_POINT)
      .map((m) => m.canonical);
    make(
      { kind: 'TALKING_POINT', text: `Built with ${joinList(names)} (from README)` },
      `Technologies named in the README of ${repo.fullName}`,
      `talking:readme-tech:${scope}`,
    );
  }
  if (repo.primaryLanguage) {
    const share = shares.get(repo.primaryLanguage);
    const text =
      share !== undefined
        ? `Primary language ${repo.primaryLanguage} (${Math.round(share * 100)}% of code)`
        : `Primary language ${repo.primaryLanguage}`;
    make(
      { kind: 'TALKING_POINT', text },
      `GitHub primary language${share !== undefined ? ' and language statistics' : ''} for ${repo.fullName}`,
      `talking:primary-language:${scope}`,
    );
  }
  if (repo.prCount > 0) {
    make(
      {
        kind: 'TALKING_POINT',
        text: `${repo.prCount} merged pull request${repo.prCount === 1 ? '' : 's'} sampled`,
      },
      `Pull request sample count recorded for ${repo.fullName}`,
      `talking:pr-sample:${scope}`,
    );
  }
  if (repo.contributors.length >= 2) {
    make(
      {
        kind: 'TALKING_POINT',
        text: `Repository has ${repo.contributors.length} contributors on GitHub`,
      },
      `Contributor list returned by GitHub for ${repo.fullName}`,
      `talking:contributors:${scope}`,
    );
  }
  if (repo.topics.length > 0) {
    make(
      {
        kind: 'TALKING_POINT',
        text: `Repository topics: ${repo.topics.slice(0, 8).join(', ')}`,
      },
      `GitHub topics on ${repo.fullName}`,
      `talking:topics:${scope}`,
    );
  }

  // 6. Project summary: verbatim README paragraph, else the repository description.
  const paragraph = firstReadmeParagraph(repo.readmeExcerpt);
  const description = repo.description?.trim();
  if (paragraph) {
    make(
      { kind: 'PROJECT_SUMMARY', text: excerpt(paragraph) },
      `Verbatim excerpt of the first paragraph of the README of ${repo.fullName}`,
      `summary:readme:${scope}`,
    );
  } else if (description) {
    make(
      { kind: 'PROJECT_SUMMARY', text: excerpt(description) },
      `Verbatim GitHub repository description of ${repo.fullName}`,
      `summary:description:${scope}`,
    );
  }

  // 7. Competencies — explicit phrases only.
  const haystack = `${repo.readmeExcerpt ?? ''}\n${repo.description ?? ''}`.toLowerCase();
  for (const { competency, phrases } of COMPETENCY_PHRASES) {
    const hit = phrases.find((p) => haystack.includes(p));
    if (!hit) continue;
    make(
      { kind: 'COMPETENCY', competency },
      `The README or description of ${repo.fullName} contains the phrase "${hit}"`,
      `competency:${competency.toLowerCase()}:${scope}`,
    );
  }

  return out;
}
