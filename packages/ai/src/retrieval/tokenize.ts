const STOPWORDS = new Set([
  'the', 'and', 'or', 'a', 'an', 'to', 'of', 'in', 'for', 'with', 'on', 'as',
  'is', 'are', 'that', 'this', 'will', 'be', 'we', 'you', 'our', 'your', 'it',
  'at', 'by', 'from', 'have', 'has', 'not', 'but', 'if', 'can', 'do', 'does',
  'us', 'their', 'they', 'them', 'i', 'about', 'into', 'than', 'such', 'who',
]);

/**
 * Deterministic keyword extraction — lowercase, strip punctuation (keeping internal hyphens
 * so "front-end" survives as one token), drop stopwords and single/double-char noise, dedupe.
 * Zero LLM calls (docs/AI_GROUNDING.md §2 step 2). Pure and side-effect-free so retrieval
 * scoring is reproducible run to run.
 */
export function extractKeywords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  return new Set(tokens);
}
