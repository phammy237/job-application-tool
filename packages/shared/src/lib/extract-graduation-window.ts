/**
 * Conservative, deterministic graduation-window extraction (docs/JOB_DISCOVERY.md "Graduation
 * eligibility"). Rather than enumerate every possible phrasing ("graduating between December
 * 2027 and June 2028", "class of 2027 or 2028", "2027-2028 graduates" — all real, differently-
 * worded examples of the same underlying fact), this finds a sentence that mentions
 * graduation and reads the plausible 4-digit year(s) inside it directly: one year found -> that
 * exact year is the window; exactly two years found -> the window spans them (min/max, order-
 * independent); zero or more than two is too ambiguous to trust, so it returns null rather than
 * guessing which of several numbers is the real window.
 *
 * Bounded to a sane calendar-year range (2015-2035) so an unrelated large number never gets
 * mistaken for a year.
 */
export interface GraduationYearWindow {
  min: number;
  max: number;
}

const MIN_PLAUSIBLE_YEAR = 2015;
const MAX_PLAUSIBLE_YEAR = 2035;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function plausibleYears(sentence: string): number[] {
  const matches = sentence.match(/\b(20\d{2})\b/g) ?? [];
  return matches
    .map(Number)
    .filter((year) => year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR);
}

export function extractGraduationWindow(plainText: string): GraduationYearWindow | null {
  for (const sentence of splitSentences(plainText)) {
    if (!/graduat/i.test(sentence)) continue;

    const years = [...new Set(plausibleYears(sentence))];
    if (years.length === 1 && years[0] !== undefined) {
      return { min: years[0], max: years[0] };
    }
    if (years.length === 2 && years[0] !== undefined && years[1] !== undefined) {
      return { min: Math.min(years[0], years[1]), max: Math.max(years[0], years[1]) };
    }
    // 0 or 3+ plausible years in a graduation-mentioning sentence is too ambiguous to trust —
    // keep scanning later sentences rather than guessing.
  }
  return null;
}
