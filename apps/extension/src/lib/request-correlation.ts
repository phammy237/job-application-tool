/**
 * chrome.runtime.sendMessage is a broadcast — every part of the extension that's listening
 * receives every message, with no built-in way to target "just the operation that asked" or
 * "just the tab I injected into." useAnalysis.ts and useAutofill.ts both need the same decision
 * — "is this incoming result actually the one I'm currently waiting on?" — extracted here as a
 * pure function so the decision itself is directly unit-testable, not just reachable through a
 * React hook's internal ref (docs/IMPLEMENTATION_PLAN.md Phase 4D).
 */

/** A fresh, unguessable identifier for one popup-initiated operation (ANALYZE_JOB or
 * AUTOFILL_APPROVED_FIELDS) — call once per user-triggered action, before sending the request. */
export function startRequest(): string {
  return crypto.randomUUID();
}

/**
 * True only when `incomingRequestId` is the exact request currently pending. False for:
 * every other case — a stale/superseded request (a newer one has since started), a response
 * that was never this popup's request at all (e.g. broadcast from another tab's in-flight
 * operation, or a leftover from a previous popup instance), and the "nothing pending" case
 * (`pendingRequestId` is `null` — no operation is currently awaited, so nothing can match).
 */
export function isCurrentRequest(
  pendingRequestId: string | null,
  incomingRequestId: string,
): boolean {
  return pendingRequestId !== null && pendingRequestId === incomingRequestId;
}
