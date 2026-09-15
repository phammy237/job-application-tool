import type { CompanyResearchSnapshot } from '../schemas/company-research';

/**
 * Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §6/§7) — a company-research snapshot is
 * immutable and freezes its own `companyName`/`roleTitle`/`jobSnapshotId` at research time
 * (docs/COMPANY_RESEARCH.md); this application's own `company`/`title`/`jobSnapshotId` can change
 * afterward (a rename, a re-imported job posting). A snapshot is only safe to fold into a
 * tailoring request when it still describes the same company/role this application is currently
 * for — never used silently on a mismatch (§7: "do not silently use it").
 *
 * `jobSnapshotId` is the strongest identity signal available (an exact immutable job posting), so
 * when the snapshot recorded one, it alone decides compatibility — `roleTitle` is not
 * independently re-checked in that case (a job's own title can be phrased slightly differently
 * from the application's `title` field without that being a real mismatch). When the snapshot has
 * no `jobSnapshotId` (research done before a job posting was ever attached, or the job snapshot
 * was later cleared), `roleTitle` is the next-best proxy.
 *
 * Deliberately does NOT require `snapshot.applicationId === applicationId` — a snapshot's
 * `application_id` is nulled when its original application is deleted (Phase 7G §7's own
 * historical-value posture), and an explicitly-requested older snapshot for the *same* company/
 * role is still legitimately reusable even if it was originally researched under a different
 * application id (e.g. the user re-applied to the same role later).
 */
export function isCompanyResearchSnapshotCompatible(
  snapshot: CompanyResearchSnapshot,
  application: { company: string; title: string; jobSnapshotId: string | null },
): boolean {
  if (normalize(snapshot.companyName) !== normalize(application.company)) {
    return false;
  }
  if (snapshot.jobSnapshotId !== null) {
    return snapshot.jobSnapshotId === application.jobSnapshotId;
  }
  return normalize(snapshot.roleTitle) === normalize(application.title);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
