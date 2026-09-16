/**
 * Deterministic, non-AI location normalization (docs/JOB_DISCOVERY.md "Location"). The original
 * provider text is always retained verbatim (`job_catalog.location_text`) — this module only
 * derives a comparison string and, when a pattern is unambiguous, structured city/state/country.
 * "Never guess": every field that can't be confidently derived stays null rather than a best
 * guess.
 */

export interface ParsedLocation {
  city: string | null;
  stateRegion: string | null;
  country: string | null;
}

/** Comparison-only representation — whitespace/case normalized, nothing structural. */
export function normalizeLocationText(locationText: string): string {
  return locationText.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// US state/territory two-letter codes. Used only to recognize the extremely common "City, ST"
// job-posting convention. Known, documented limitation: a handful of these codes (e.g. "CA")
// collide with ISO country codes — this heuristic always resolves that ambiguity as the US state
// reading, since "City, ST" for a two-letter *country* code is not a convention any of the three
// supported ATS providers actually use in free-text location strings. Never applied to anything
// but the strict two-part "City, XX" shape.
// Exported so the D4 location-token extractor (extract-location-tokens.ts) can reuse the exact
// same recognized-state set rather than duplicating it — purely additive visibility change, no
// behavior here changes.
export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC', 'PR',
]);

// A small, curated set of full country names that appear verbatim as the trailing segment of a
// "City, Country" location string across real ATS postings. Deliberately not exhaustive — an
// unrecognized trailing segment stays unparsed rather than guessed.
const KNOWN_COUNTRIES = new Set([
  'united states', 'usa', 'us', 'united kingdom', 'uk', 'canada', 'germany', 'france', 'ireland',
  'india', 'australia', 'singapore', 'netherlands', 'spain', 'italy', 'japan', 'brazil', 'mexico',
  'poland', 'sweden', 'switzerland',
]);

/**
 * Attempts a conservative structured parse of a free-text location string. Only ever fills a
 * field when the pattern is unambiguous; everything else is left null. Multi-location strings
 * (e.g. "Seattle, San Francisco, New York City") are intentionally left entirely unparsed — there
 * is no single city/state/country to assign.
 */
export function parseLocation(locationText: string): ParsedLocation {
  const empty: ParsedLocation = { city: null, stateRegion: null, country: null };

  const trimmed = locationText.normalize('NFC').trim();
  if (!trimmed) return empty;

  // Reject anything that looks like more than one place ("A, B, C" or "A / B").
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return empty;
  if (parts.some((part) => part.includes('/'))) return empty;

  if (parts.length === 1) return empty;

  const [rawCity, rawSecond] = parts;
  if (!rawCity || !rawSecond) return empty;

  const secondUpper = rawSecond.toUpperCase();
  if (secondUpper.length === 2 && US_STATE_CODES.has(secondUpper)) {
    return { city: rawCity, stateRegion: secondUpper, country: 'United States' };
  }

  const secondLower = rawSecond.toLowerCase();
  if (KNOWN_COUNTRIES.has(secondLower)) {
    return { city: rawCity, stateRegion: null, country: rawSecond };
  }

  return empty;
}
