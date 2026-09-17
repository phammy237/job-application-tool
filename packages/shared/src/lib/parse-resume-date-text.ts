/**
 * Converts a raw résumé date string (e.g. "May 2025", "05/2025", "2025-05", "2025") to an ISO
 * "YYYY-MM-DD" date — never inventing a date the résumé didn't state. This is normalization, not
 * inference (docs/JOB_DISCOVERY.md's own "normalize obvious date formatting" allowance,
 * Resume-Import's equivalent): defaulting an unspecified day to "01" when only month/year are
 * given is a representation choice ISO 8601 requires, not a fabricated fact — the month and year
 * are always exactly what the text said. Returns null for anything not confidently parseable
 * (an ongoing "Present"/"Current" marker, a malformed string, empty input) rather than guessing.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseResumeDateText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^(present|current|ongoing|now)$/i.test(trimmed)) return null;

  // "May 2025" / "May, 2025"
  const monthYear = /^([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(trimmed);
  if (monthYear?.[1] && monthYear[2]) {
    const month = MONTH_NAMES[monthYear[1].toLowerCase()];
    if (month) return `${monthYear[2]}-${pad(month)}-01`;
  }

  // "05/2025" or "5/2025"
  const slashMonthYear = /^(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMonthYear?.[1] && slashMonthYear[2]) {
    const month = Number(slashMonthYear[1]);
    if (month >= 1 && month <= 12) return `${slashMonthYear[2]}-${pad(month)}-01`;
  }

  // "2025-05" (already ISO year-month)
  const isoYearMonth = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (isoYearMonth?.[1] && isoYearMonth[2]) {
    const month = Number(isoYearMonth[2]);
    if (month >= 1 && month <= 12) return `${isoYearMonth[1]}-${isoYearMonth[2]}-01`;
  }

  // Already a full ISO date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // "2025" (year only)
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;

  return null;
}
