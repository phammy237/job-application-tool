import { containsPhrase } from './phrase-matcher';

/**
 * D4 V1 competency/skill concept registry (docs/JOB_DISCOVERY.md "Competency / skill fit").
 * Deliberately small — concepts here are justified by observed candidate-profile vocabulary,
 * observed catalog vocabulary, and the target role families (PM/TPM/analytics-leaning), not a
 * speculative general-purpose ontology. Each concept is matched via explicit, word/phrase-
 * boundary-safe aliases (`phrase-matcher.ts`) — never a raw substring search.
 *
 * A short/ambiguous token is a real false-positive risk (the canonical example: bare "R", "C",
 * "AI" can match inside unrelated words or as English words themselves) — V1 deliberately
 * excludes bare single-letter language names ("R", "C", "Go") from this registry entirely rather
 * than risk it; "C++"/"C#" are safe (unambiguous) and included.
 *
 * New concepts can be added by extending this array — no other file needs to change to add one.
 */
export interface CompetencyConcept {
  code: string;
  aliases: readonly string[];
}

export const COMPETENCY_CONCEPTS: readonly CompetencyConcept[] = [
  // Technical
  { code: 'SQL', aliases: ['sql'] },
  { code: 'PYTHON', aliases: ['python'] },
  { code: 'JAVASCRIPT', aliases: ['javascript', 'typescript'] },
  { code: 'CPLUSPLUS', aliases: ['c++'] },
  { code: 'CSHARP', aliases: ['c#'] },
  { code: 'DATA_ANALYSIS', aliases: ['data analysis', 'data analyses'] },
  {
    code: 'MACHINE_LEARNING',
    aliases: ['machine learning', 'artificial intelligence'],
  },

  // Product / business
  { code: 'PRODUCT_STRATEGY', aliases: ['product strategy'] },
  { code: 'PRODUCT_ANALYTICS', aliases: ['product analytics'] },
  { code: 'EXPERIMENTATION', aliases: ['experimentation', 'a/b testing', 'ab testing'] },
  { code: 'CUSTOMER_RESEARCH', aliases: ['customer research', 'user research'] },
  { code: 'ROADMAP', aliases: ['roadmap', 'product roadmap'] },
  { code: 'STAKEHOLDER_MANAGEMENT', aliases: ['stakeholder management'] },
  {
    code: 'CROSS_FUNCTIONAL_COLLABORATION',
    aliases: ['cross-functional', 'cross functional'],
  },
  {
    code: 'PROJECT_PROGRAM_MANAGEMENT',
    aliases: ['project management', 'program management'],
  },
  { code: 'B2B_SOFTWARE', aliases: ['b2b', 'business-to-business'] },
  { code: 'TECHNICAL_FLUENCY', aliases: ['technical fluency', 'technically fluent'] },
];

/** Every distinct concept code found in `text`, in registry order, each counted once regardless
 * of how many times its aliases repeat in the source text. */
export function matchCompetencyConcepts(text: string): string[] {
  const matched: string[] = [];
  for (const concept of COMPETENCY_CONCEPTS) {
    if (concept.aliases.some((alias) => containsPhrase(text, alias))) {
      matched.push(concept.code);
    }
  }
  return matched;
}
