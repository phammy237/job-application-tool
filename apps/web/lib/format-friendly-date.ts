/**
 * One consistent human-readable timestamp format for product UI — "Aug 10, 2026 · 4:56 AM" —
 * replacing the several inline `.toLocaleDateString()`/`.toLocaleString()` call sites that each
 * picked their own shape (e.g. the native "8/10/2026, 4:56:18 AM"). Locale-aware (uses the
 * viewer's own locale for month names/ordering) but with a fixed, deliberately chosen set of
 * parts — never seconds, never a raw numeric date.
 */
export function formatFriendlyDateTime(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${datePart} · ${timePart}`;
}

/** Date-only variant (no time) for contexts where the time of day isn't meaningful — e.g. "when
 * was this job posted." */
export function formatFriendlyDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
