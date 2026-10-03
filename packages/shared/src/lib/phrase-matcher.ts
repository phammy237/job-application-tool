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

/** Negation words that, found shortly before a matched phrase, flip its meaning — "No active
 * clearance required" is not the same statement as "Active clearance required". Deliberately a
 * short, high-precision list (not "n't"-style contraction splitting) — a missed negation only
 * ever falls back to the always-safe UNKNOWN/no-match outcome in every caller of
 * containsPhraseOutsideNegation, never a wrong-direction classification. */
const NEGATION_WORDS = ['no', 'not', 'without', 'never', 'none'];
/** How many words immediately before a match are checked for a negation word — bounded so an
 * unrelated negation earlier in a long sentence doesn't suppress a real, later, un-negated
 * requirement in the same sentence. */
const NEGATION_LOOKBACK_WORDS = 4;

/**
 * Like `containsPhrase`, but a match immediately preceded by a negation word (within
 * `NEGATION_LOOKBACK_WORDS`) does not count — "No active clearance required, but you must be
 * willing to obtain one" must not be read as requiring an active clearance. Scans every
 * occurrence of `phrase` in `text` and accepts the first one that isn't negated, so a sentence
 * that negates one occurrence and states the requirement plainly elsewhere still matches.
 */
export function containsPhraseOutsideNegation(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(phrase)}(?![A-Za-z0-9])`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const precedingWords = text
      .slice(0, match.index)
      .trim()
      .split(/\s+/)
      .slice(-NEGATION_LOOKBACK_WORDS)
      .join(' ');
    const negated = NEGATION_WORDS.some((word) => containsPhrase(precedingWords, word));
    if (!negated) return true;
  }
  return false;
}
