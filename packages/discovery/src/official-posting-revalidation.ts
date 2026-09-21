import {
  listResolvedPostingsForRevalidation,
  recordOfficialPostingLivenessCheck,
  recordOfficialPostingRevalidationDemotion,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  confirmHighCandidatePage,
  decideHighFromConfirmation,
  type HighConfirmationOutcome,
  type HighDecision,
} from './official-posting-resolution';

/**
 * Re-checks already-stored RESOLVED_HIGH_CONFIDENCE rows against the current final page-identity
 * confirmation (`confirmHighCandidatePage` + `decideHighFromConfirmation` — the exact logic a fresh
 * resolution now applies before persisting HIGH). No search, one bounded page fetch per stored
 * `canonical_apply_url`, never a promotion:
 *   - decision HIGH  → row left byte-for-byte unchanged (a link-failure counter is reset only if it
 *                      was non-zero);
 *   - decision REVIEW (closed page, or an accepted-ATS page with no confirmable identity)
 *                    → RESOLVED_REVIEW, old URL kept as `resolution_candidate_url`, canonical cleared;
 *   - decision DROP  (the page identifies a different job) → UNRESOLVED, canonical cleared;
 *   - UNREACHABLE    → the existing two-strike link check (`recordOfficialPostingLivenessCheck`): one
 *                      transient failure is only counted, the second consecutive one clears canonical
 *                      and marks UNRESOLVED. A stored row is never demoted on a single network blip.
 * Idempotent: a demoted row is no longer HIGH so it is never selected again; an unchanged row
 * produces the same result and no write.
 */

const DEMOTED_REVIEW_CONFIDENCE = 72; // round(90 * 0.8), same as the resolver's own demotion

export type RevalidationAction =
  | 'UNCHANGED'
  | 'DEMOTED_TO_REVIEW'
  | 'DEMOTED_TO_UNRESOLVED'
  | 'LINK_FAILURE_RECORDED';

export interface RevalidationRowReport {
  jobCatalogId: string;
  companyName: string;
  title: string;
  url: string;
  outcome: HighConfirmationOutcome;
  decision: HighDecision;
  action: RevalidationAction;
  reason: string;
  /** Set only when the fetch ended on a different host than the stored URL's (diagnostic). */
  redirectedToHost: string | null;
}

export interface RevalidationSummary {
  checked: number;
  unchanged: number;
  demotedToReview: number;
  demotedToUnresolved: number;
  linkFailuresRecorded: number;
  byOutcome: Partial<Record<HighConfirmationOutcome, number>>;
  rows: RevalidationRowReport[];
}

function differentHost(stored: string, finalUrl: string | null): string | null {
  if (!finalUrl) return null;
  try {
    const finalHost = new URL(finalUrl).hostname;
    return finalHost !== new URL(stored).hostname ? finalHost : null;
  } catch {
    return null;
  }
}

export async function runOfficialPostingRevalidation(
  supabase: CareerOsSupabaseClient,
  params: { jobrightSourceIds: string[] },
  options: { maxCount: number; dryRun: boolean; now?: Date },
): Promise<RevalidationSummary> {
  const now = options.now ?? new Date();
  const candidates = await listResolvedPostingsForRevalidation(supabase, params.jobrightSourceIds, {
    validationIntervalMs: 0,
    maxCount: options.maxCount,
    now,
  });

  const summary: RevalidationSummary = {
    checked: 0,
    unchanged: 0,
    demotedToReview: 0,
    demotedToUnresolved: 0,
    linkFailuresRecorded: 0,
    byOutcome: {},
    rows: [],
  };

  // Sequential on purpose: a bounded, polite one-request-per-row pass, not a crawl.
  for (const candidate of candidates) {
    const confirmation = await confirmHighCandidatePage(candidate.canonicalApplyUrl, {
      companyName: candidate.companyName,
      title: candidate.title,
    });
    const decision = decideHighFromConfirmation(confirmation.outcome, confirmation.hostClass);

    let action: RevalidationAction;
    if (confirmation.outcome === 'UNREACHABLE') {
      action = 'LINK_FAILURE_RECORDED';
      if (!options.dryRun) {
        await recordOfficialPostingLivenessCheck(
          supabase,
          candidate.jobCatalogId,
          { reachable: false },
          candidate.linkCheckFailures,
          now,
        );
      }
    } else if (decision === 'HIGH') {
      action = 'UNCHANGED';
      if (!options.dryRun && candidate.linkCheckFailures > 0) {
        await recordOfficialPostingLivenessCheck(
          supabase,
          candidate.jobCatalogId,
          { reachable: true },
          candidate.linkCheckFailures,
          now,
        );
      }
    } else if (decision === 'REVIEW') {
      action = 'DEMOTED_TO_REVIEW';
      if (!options.dryRun) {
        await recordOfficialPostingRevalidationDemotion(
          supabase,
          candidate.jobCatalogId,
          { to: 'RESOLVED_REVIEW', candidateUrl: candidate.canonicalApplyUrl, confidence: DEMOTED_REVIEW_CONFIDENCE },
          now,
        );
      }
    } else {
      action = 'DEMOTED_TO_UNRESOLVED';
      if (!options.dryRun) {
        await recordOfficialPostingRevalidationDemotion(
          supabase,
          candidate.jobCatalogId,
          { to: 'UNRESOLVED' },
          now,
        );
      }
    }

    summary.checked += 1;
    summary.byOutcome[confirmation.outcome] = (summary.byOutcome[confirmation.outcome] ?? 0) + 1;
    if (action === 'UNCHANGED') summary.unchanged += 1;
    else if (action === 'DEMOTED_TO_REVIEW') summary.demotedToReview += 1;
    else if (action === 'DEMOTED_TO_UNRESOLVED') summary.demotedToUnresolved += 1;
    else summary.linkFailuresRecorded += 1;

    summary.rows.push({
      jobCatalogId: candidate.jobCatalogId,
      companyName: candidate.companyName,
      title: candidate.title,
      url: candidate.canonicalApplyUrl,
      outcome: confirmation.outcome,
      decision,
      action,
      reason: confirmation.reason,
      redirectedToHost: differentHost(candidate.canonicalApplyUrl, confirmation.finalUrl),
    });
  }
  return summary;
}
