import { US_STATE_CODES } from './normalize-location';

/**
 * D4-specific location tokenization (docs/JOB_DISCOVERY.md "Location normalization") — a
 * *different, additive* module from D1-D3's `normalize-location.ts`/`parseLocation` (job_catalog's
 * own `city`/`state_region`/`country` columns are untouched by this file). No geocoding: a small,
 * deterministic alias table sufficient for user location-preference *matching*, not mapping.
 *
 * Multi-location postings are preserved as multiple tokens, never collapsed to one and never
 * forced into a single "best" location — `"Seattle, San Francisco, New York City"` stays
 * unparsed (comma-only multi-city remains genuinely ambiguous with the "City, ST" convention,
 * the same conservative call D1-D3 already made); `"New York, NY; San Francisco, CA"` — a
 * real live-observed value using an unambiguous separator — correctly tokenizes to both.
 * Equivalent raw strings for the same place normalize to the same token:
 * `"New York, NY (HQ)"`, `"New York, NY"`, and `"New York, New York"` all produce `NEW_YORK_NY`.
 */

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington, d.c.': 'DC',
};

// Deliberately small — only aliases actually observed in the live catalog (docs/JOB_DISCOVERY.md
// profiling) or trivially certain. Unrecognized country text stays untokenized, never guessed.
const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'UNITED_STATES', usa: 'UNITED_STATES', us: 'UNITED_STATES',
  'u.s.': 'UNITED_STATES', 'u.s.a.': 'UNITED_STATES',
  'united kingdom': 'UNITED_KINGDOM', uk: 'UNITED_KINGDOM', 'u.k.': 'UNITED_KINGDOM',
  ireland: 'IRELAND', canada: 'CANADA', germany: 'GERMANY', france: 'FRANCE', india: 'INDIA',
  australia: 'AUSTRALIA', singapore: 'SINGAPORE', netherlands: 'NETHERLANDS', spain: 'SPAIN',
  italy: 'ITALY', japan: 'JAPAN', brazil: 'BRAZIL', mexico: 'MEXICO', poland: 'POLAND',
  sweden: 'SWEDEN', switzerland: 'SWITZERLAND',
};

function slug(value: string): string {
  return value
    .normalize('NFC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stripTrailingParenthetical(value: string): string {
  let result = value.trim();
  let previous: string;
  do {
    previous = result;
    result = result.replace(/\s*\([^)]*\)\s*$/, '').trim();
  } while (result !== previous);
  return result;
}

/** Tokenizes one single-place segment (no separators) — city+region, or a bare country. */
function tokenizeSegment(segment: string): string | null {
  const cleaned = stripTrailingParenthetical(segment);
  if (!cleaned) return null;

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    const [city, regionRaw] = parts;
    if (!city || !regionRaw) return null;
    const regionUpper = regionRaw.toUpperCase();
    if (regionUpper.length === 2 && US_STATE_CODES.has(regionUpper)) {
      return `${slug(city)}_${regionUpper}`;
    }
    const stateCode = US_STATE_NAME_TO_CODE[regionRaw.toLowerCase()];
    if (stateCode) return `${slug(city)}_${stateCode}`;

    const countryToken = COUNTRY_ALIASES[regionRaw.toLowerCase()];
    if (countryToken) return `${slug(city)}_${countryToken}`;

    return null;
  }

  if (parts.length === 1) {
    const bare = parts[0];
    if (!bare) return null;
    const countryToken = COUNTRY_ALIASES[bare.toLowerCase()];
    if (countryToken) return countryToken;
    return null;
  }

  // 3+ comma-separated parts is the same genuinely-ambiguous multi-city shape D1-D3's own
  // parseLocation already refuses to guess at (e.g. "Seattle, San Francisco, New York City").
  return null;
}

/**
 * Returns the deduplicated, order-preserved set of recognized location tokens for a posting's
 * free-text location. An empty array means UNKNOWN — never guessed, never defaulted to a single
 * "primary" location.
 */
export function extractLocationTokens(locationText: string | null): string[] {
  if (!locationText) return [];

  const segments = locationText.split(';');
  const tokens: string[] = [];
  for (const segment of segments) {
    const token = tokenizeSegment(segment);
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}
