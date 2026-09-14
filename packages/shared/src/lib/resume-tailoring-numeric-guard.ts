/**
 * Deterministic numeric-claim grounding (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §15) — a
 * proposed bullet may not introduce a percentage, dollar value, count, multiplier, or growth
 * factor that isn't already present in either the original bullet text (for a rewrite) or the
 * cited approved facts. This is intentionally strict and a little blunt (§15: "strict
 * deterministic number protection") — false rejections (a legitimately-preserved number written
 * in a slightly different notation) fail safe into a retry or a visible rejection, never into a
 * silently-accepted fabricated metric.
 *
 * Known limitations, documented rather than hidden:
 * - A dollar amount written without a leading `$` (e.g. "saved 50K in costs") is categorized as
 *   a bare count, not currency — it will not match an evidence figure written as "$50,000" even
 *   though a human reader would consider them the same claim. Over-rejection, not under.
 * - A 4-digit bare number in the 1900-2099 range with no `%`/`$`/k-m-b suffix is treated as a
 *   calendar year and excluded from extraction entirely, so it is never flagged as an
 *   ungrounded metric — but a genuine 4-digit *count* in that numeric range (implausible for a
 *   résumé bullet, but not impossible) would be missed by this guard. Accepted tradeoff: résumé
 *   bullets overwhelmingly mention years in prose ("since 2021"), never four-digit counts.
 */

export type NumericClaimCategory = 'PERCENT' | 'CURRENCY' | 'COUNT' | 'FACTOR';

export interface NumericClaim {
  raw: string;
  normalized: number;
  category: NumericClaimCategory;
}

function multiplierFor(suffix: string | undefined): number {
  if (!suffix) return 1;
  switch (suffix.toLowerCase()) {
    case 'k':
      return 1_000;
    case 'm':
      return 1_000_000;
    case 'b':
      return 1_000_000_000;
    default:
      return 1;
  }
}

const YEAR_MIN = 1900;
const YEAR_MAX = 2099;

/** One pass, left to right, non-overlapping — every digit run in the text is claimed by exactly
 * one match, so there is no double-counting between this and a second pass. */
// The negative lookahead is scoped *inside* the optional suffix group (not after it) — it must
// only block the suffix from being consumed when it's immediately followed by another letter
// (so "100ms" doesn't misread "m" as a million multiplier), without blocking the number itself
// from matching at all when that happens. "50k users"/"70%" still match normally; "100ms"/"50Kg"
// fall back to no-suffix, leaving the trailing unit letters simply unmatched by this regex.
const NUMERIC_TOKEN_RE = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s*(?:([kKmMbB]|[xX]|%)(?![a-zA-Z]))?\+?/g;

export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];

  for (const match of text.matchAll(NUMERIC_TOKEN_RE)) {
    const [raw, dollar, digits, suffix] = match;
    if (!digits) continue;
    const base = parseFloat(digits.replace(/,/g, ''));
    if (Number.isNaN(base)) continue;

    // A bare 4-digit number in a plausible calendar-year range, with no $/%/k-m-b marking it as
    // a metric, is treated as a date mentioned in prose — not a claim needing grounding.
    if (!dollar && !suffix && /^\d{4}$/.test(digits) && base >= YEAR_MIN && base <= YEAR_MAX) {
      continue;
    }

    let category: NumericClaimCategory;
    let normalized = base;
    if (suffix === '%') {
      category = 'PERCENT';
    } else if (dollar) {
      category = 'CURRENCY';
      normalized = base * multiplierFor(suffix);
    } else if (suffix && /[xX]/.test(suffix)) {
      category = 'FACTOR';
    } else if (suffix && /[kKmMbB]/.test(suffix)) {
      category = 'COUNT';
      normalized = base * multiplierFor(suffix);
    } else {
      category = 'COUNT';
    }

    claims.push({ raw: raw.trim(), normalized, category });
  }

  return claims;
}

const EPSILON = 1e-6;

function isClaimGrounded(claim: NumericClaim, evidenceClaims: NumericClaim[]): boolean {
  return evidenceClaims.some(
    (evidence) =>
      evidence.category === claim.category &&
      Math.abs(evidence.normalized - claim.normalized) < EPSILON,
  );
}

/**
 * Every numeric claim in `proposedText` that does not appear (same category, same normalized
 * value) anywhere in `evidenceTexts` — an empty array means every number in the proposal is
 * grounded (including "no numbers at all," the common case). Callers pass the original bullet
 * text (rewrite only) and every cited fact's text as `evidenceTexts`.
 */
export function findUngroundedNumericClaims(
  proposedText: string,
  evidenceTexts: string[],
): NumericClaim[] {
  const proposedClaims = extractNumericClaims(proposedText);
  if (proposedClaims.length === 0) return [];
  const evidenceClaims = evidenceTexts.flatMap(extractNumericClaims);
  return proposedClaims.filter((claim) => !isClaimGrounded(claim, evidenceClaims));
}
