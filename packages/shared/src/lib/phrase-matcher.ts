/**
 * Shared word/phrase-boundary matching helper used by every deterministic title/description
 * classifier in the Job Discovery ranking engine (docs/JOB_DISCOVERY.md). Short tokens like "R",
 * "C", "AI" must never fire on a substring inside an unrelated word (CLAUDE.md-adjacent "never
 * invent a fact" extends to "never invent a keyword match").
 *
 * Uses explicit lookaround (not plain regex `\b`) so this also works correctly for phrases that
 * themselves end/start in a non-alphanumeric character — e.g. "C++" or "Sr." followed by a space:
 * `\b` is only a boundary between a `\w` and non-`\w` character, so `\bc\+\+\b` never matches
 * "C++ Engineer" at all (both the `+` and the following space are non-word, so there's no `\b`
 * between them). Matching "not preceded/followed by an alphanumeric character" instead sidesteps
 * that entirely and behaves correctly in both cases.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `phrase` appears in `text` as a whole word/phrase (case-insensitive). */
export function containsPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(phrase)}(?![A-Za-z0-9])`, 'i');
  return pattern.test(text);
}

/** The first phrase (in list order) that appears in `text`, or null. */
export function firstMatchingPhrase(text: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (containsPhrase(text, phrase)) return phrase;
  }
  return null;
}
