const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// A posted date more than this far in the future (relative to the sync run) is treated as
// belonging to a prior year instead — Jobright's README only ever shows a year-less "Sep 17"
// style date, so the year has to be inferred, and a "posted" date should never land meaningfully
// ahead of when the sync observed it.
const FUTURE_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Parses Jobright's year-less README date format ("Sep 17", "Dec 20") into a full ISO-8601
 * instant, inferring the year deterministically from `referenceDate` (docs/JOB_DISCOVERY.md
 * "Posted date"). Never guesses on a genuinely malformed string — returns null instead.
 *
 * Year inference tries {referenceYear - 1, referenceYear, referenceYear + 1} and picks whichever
 * produces the date closest to `referenceDate` without landing more than
 * `FUTURE_TOLERANCE_MS` in the future. This handles the Dec/Jan boundary correctly (syncing in
 * early January against a "Dec 30" row resolves to the *previous* December, not one 362 days
 * away) without ever needing to know which repo/season the row came from.
 */
export function parseJobrightPostedDate(
  text: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(trimmed);
  if (!match) return null;

  const monthKey = match[1]!.slice(0, 3).toLowerCase();
  const month = MONTHS[monthKey];
  const day = Number(match[2]);
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) return null;

  const referenceYear = referenceDate.getUTCFullYear();
  const candidates: Date[] = [];
  for (const year of [referenceYear - 1, referenceYear, referenceYear + 1]) {
    const candidate: Date = new Date(Date.UTC(year, month, day));
    // Date rolls an invalid day (e.g. Feb 30) into the next month — reject rather than guess.
    if (candidate.getUTCMonth() === month) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;

  const withinTolerance = candidates.filter(
    (candidate: Date) => candidate.getTime() - referenceDate.getTime() <= FUTURE_TOLERANCE_MS,
  );
  const pool = withinTolerance.length > 0 ? withinTolerance : candidates;

  let best: Date = pool[0]!;
  let bestDiff = Math.abs(best.getTime() - referenceDate.getTime());
  for (const candidate of pool.slice(1)) {
    const diff = Math.abs(candidate.getTime() - referenceDate.getTime());
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best.toISOString();
}
