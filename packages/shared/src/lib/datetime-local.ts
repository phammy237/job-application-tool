/**
 * Conversion between an HTML `<input type="datetime-local">`'s value (a timezone-less
 * "YYYY-MM-DDTHH:mm" string, always interpreted as whatever timezone it's read in) and a real
 * ISO-8601 UTC timestamp (what `occurredAt` is stored/transmitted as everywhere else —
 * docs/IMPLEMENTATION_PLAN.md "Phase 6B" §25). Both directions go through the platform `Date`
 * object, so both are only ever correct when run in the timezone the value is meant to represent
 * — the browser's local timezone. Never run server-side against a value meant for a specific
 * user's browser (a server process's timezone need not match the user's).
 */

/** Zero-pads to at least `length` digits — used for both date and time components below (a
 * single-digit hour would otherwise produce an invalid "2026-1-1T9:5" string). */
function pad(n: number, length = 2): string {
  return String(n).padStart(length, '0');
}

/**
 * Converts a real ISO timestamp into the local "YYYY-MM-DDTHH:mm" shape a `datetime-local` input
 * expects for its `value`/`defaultValue` — reading the given instant's year/month/day/hour/
 * minute in the *local* timezone the code is currently running in (`Date`'s own getters, not the
 * UTC ones), so the input actually displays the time the user experienced.
 */
export function toDatetimeLocalValue(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${pad(year, 4)}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts a `datetime-local` input's raw value back into a real ISO-8601 UTC timestamp.
 * `new Date("YYYY-MM-DDTHH:mm")` (no trailing offset) is specified to parse as local time, so
 * this is the exact inverse of `toDatetimeLocalValue` as long as both run in the same timezone —
 * true by construction, since both only ever run in the submitting user's own browser.
 */
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
