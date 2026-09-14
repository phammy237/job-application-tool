/**
 * Deterministic, deliberately conservative named-technology/tool guard
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §16) — a proposed bullet may not introduce a
 * technology/tool/framework/platform name that isn't already present in either the original
 * bullet text (for a rewrite) or the cited approved facts. This is explicitly NOT real NLP/
 * named-entity recognition (§16: "Do not attempt perfect NLP"): it is a capitalized-token
 * heuristic, documented honestly rather than presented as more accurate than it is.
 *
 * Heuristic: most technology names in résumé bullets are capitalized, ALLCAPS acronyms, or
 * contain characters ordinary English words don't (`Node.js`, `C++`, `C#`, `Python3`). Extract
 * every token matching that shape, excluding the sentence-initial word (bullets routinely start
 * with a capitalized action verb — "Built the ETL pipeline" — which is not itself a technology
 * claim) and a small stoplist of extremely common résumé action verbs that would otherwise
 * false-positive whenever they appear capitalized elsewhere in the sentence (rare, but possible
 * after a colon or dash).
 *
 * Known limitations, documented rather than hidden:
 * - Misses lowercase-written tools (`git`, `npm`, `kubectl`) — never flags them as new, whether
 *   they're genuinely new or not. This is the safe direction for a false negative here: nothing
 *   is *added* to the résumé by this guard failing to catch a lowercase word, since the guard
 *   only ever rejects (never approves and inserts) a token.
 * - Can false-positive on a capitalized proper noun that isn't a technology (an employer name
 *   inside bullet prose, an unusual product name). §16 explicitly accepts this: "prefer
 *   restricting ADD_BULLET and relying on citations/user review rather than pretending the
 *   check is perfect."
 * - Comparison is case-insensitive and exact-token — "React" and "React.js" are treated as
 *   different tokens. A proposal introducing "React.js" when evidence only says "React" is
 *   rejected; this is again the conservative direction.
 */

/** Common résumé action verbs that are capitalized when they open a bullet (excluded from
 * extraction there anyway) but occasionally appear capitalized again mid-sentence (after a
 * colon, dash, or period) — kept deliberately short and unambiguous; this is not an attempt at
 * an exhaustive verb list. */
const ACTION_VERB_STOPLIST = new Set(
  [
    'Led',
    'Built',
    'Managed',
    'Developed',
    'Created',
    'Designed',
    'Implemented',
    'Improved',
    'Increased',
    'Reduced',
    'Achieved',
    'Collaborated',
    'Delivered',
    'Drove',
    'Established',
    'Generated',
    'Grew',
    'Launched',
    'Optimized',
    'Oversaw',
    'Streamlined',
    'Automated',
    'Architected',
    'Coordinated',
    'Executed',
    'Facilitated',
    'Organized',
    'Spearheaded',
    'Utilized',
    'Directed',
    'Enhanced',
    'Expanded',
    'Maintained',
    'Mentored',
    'Negotiated',
    'Presented',
    'Resolved',
    'Trained',
    'Analyzed',
    'Authored',
    'Conducted',
    'Crafted',
    'Deployed',
    'Enabled',
    'Engineered',
    'Formulated',
    'Headed',
    'Identified',
    'Initiated',
    'Integrated',
    'Introduced',
    'Leveraged',
    'Modernized',
    'Monitored',
    'Partnered',
    'Piloted',
    'Pioneered',
    'Planned',
    'Produced',
    'Refactored',
    'Researched',
    'Restructured',
    'Revamped',
    'Scaled',
    'Simplified',
    'Supervised',
    'Supported',
    'Tested',
    'Tracked',
    'Transformed',
    'Unified',
    'Upgraded',
    'Validated',
    'Wrote',
  ].map((word) => word.toLowerCase()),
);

/** Generic business/tech-adjacent acronyms that are not themselves named technologies — "APIs"
 * is not a claim about knowing a specific tool the way "Snowflake" or "Kubernetes" is. Kept
 * short and unambiguous, same posture as the action-verb stoplist above. */
const GENERIC_ACRONYM_STOPLIST = new Set(
  [
    'API',
    'APIs',
    'URL',
    'URLs',
    'ID',
    'IDs',
    'UI',
    'UX',
    'QA',
    'KPI',
    'KPIs',
    'ROI',
    'SLA',
    'SLAs',
    'MVP',
    'POC',
    'FAQ',
    'CEO',
    'CTO',
    'CFO',
    'VP',
    'HR',
    'IT',
    'OS',
  ].map((word) => word.toLowerCase()),
);

/** Capitalized words, ALLCAPS acronyms, and tokens containing digits/`+`/`#`/`.` — see the
 * module doc comment for exactly what this does and does not catch. No trailing `\b`: a token
 * ending in a non-word character (`C++`) would otherwise fail its own trailing boundary
 * assertion and get silently truncated (`C++` -> `C`) — the character class itself already
 * bounds how far the match extends, so a second boundary assertion is unnecessary and actively
 * wrong here. */
const TECH_TOKEN_RE = /\b[A-Z][a-zA-Z0-9+#.]*/g;

export function extractTechnologyTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.trim().split(/\s+/);
  const firstWord = words[0] ?? '';

  for (const match of text.matchAll(TECH_TOKEN_RE)) {
    const token = match[0];
    // Strip a single trailing '.' that's sentence punctuation, not part of the token itself
    // (e.g. "...uses Python." should not extract "Python." as distinct from "Python").
    const cleaned = token.endsWith('.') && !token.slice(0, -1).includes('.') ? token.slice(0, -1) : token;
    if (!cleaned) continue;
    if (cleaned === firstWord || `${cleaned}.` === firstWord) continue;
    const lower = cleaned.toLowerCase();
    if (ACTION_VERB_STOPLIST.has(lower) || GENERIC_ACRONYM_STOPLIST.has(lower)) continue;
    tokens.add(lower);
  }

  return tokens;
}

/**
 * Every technology-like token in `proposedText` that does not appear anywhere in
 * `evidenceTexts` — an empty array means every technology-like token in the proposal is already
 * grounded (including "no such tokens at all," the common case for a bullet with no
 * capitalized/acronym content).
 *
 * Deliberately asymmetric: extracting *what the proposal claims* uses the strict, capitalized-
 * token heuristic above (to avoid flagging ordinary capitalized words as claims), but *checking
 * whether evidence supports it* is a lenient, case-insensitive substring search over the raw
 * evidence text — so a technology written in a different case in a fact's own text (or even
 * lowercase, e.g. "sql") still grounds it. This asymmetry is intentional: it keeps the guard
 * strict about what counts as a new claim while staying lenient about recognizing real support
 * for one, which is the safer direction to be imprecise in.
 */
export function findUngroundedTechnologyTokens(
  proposedText: string,
  evidenceTexts: string[],
): string[] {
  const proposedTokens = extractTechnologyTokens(proposedText);
  if (proposedTokens.size === 0) return [];

  const combinedEvidence = evidenceTexts.join(' \n ').toLowerCase();
  return [...proposedTokens].filter((token) => !combinedEvidence.includes(token));
}
