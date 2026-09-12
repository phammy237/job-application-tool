/**
 * Phase 5C.4 — a lightweight, non-authoritative hint for the "open in Career OS" link's label,
 * covering exactly the four statuses whose next action is fully determined by status alone (see
 * packages/shared/src/lib/next-action-rules.ts's `deriveNextAction` switch: ACTION_REQUIRED,
 * ASSESSMENT, INTERVIEW, and OFFER each map to one action regardless of any date/threshold).
 * Deliberately NOT extended to APPLIED/APPLICATION_RECEIVED ("consider following up") — that
 * decision additionally depends on `appliedAt`/the follow-up anchor/threshold, none of which this
 * popup has, and duplicating that logic here (even approximately) was explicitly out of scope
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.4" — "no duplication of next-action logic if
 * avoidable"). The web app's application detail page independently re-derives the real next
 * action regardless of this label; nothing here is authoritative or bypasses eligibility.
 *
 * A separate pure-function module (rather than living inline in ApplicationTracker.tsx) so this
 * file can export just the plain function/constant, keeping the component file exporting only its
 * component — matching this popup's existing `lib/summarize-autofill.ts` pattern.
 */
const STATUS_ACTION_HINT: Partial<Record<string, string>> = {
  ACTION_REQUIRED: 'Open Career OS — action required',
  ASSESSMENT: 'Open Career OS to complete the assessment',
  INTERVIEW: 'Open Career OS to prepare for the interview',
  OFFER: 'Open Career OS to review the offer',
};

export function openInCareerOsLabel(trackedStatus: string | null): string {
  return (trackedStatus && STATUS_ACTION_HINT[trackedStatus]) || 'Open in Career OS';
}
