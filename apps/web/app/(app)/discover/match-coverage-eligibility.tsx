import { getCoverageBucket, isLowCoverage } from '@career-os/shared';
import type { EligibilityStatus } from '@career-os/shared';
import { EligibilityBadge } from './eligibility-badge';

const COVERAGE_BAND_LABELS = { HIGH: 'High', MODERATE: 'Medium', LOW: 'Low' } as const;

/**
 * The one place Match, Coverage, and Eligibility are laid out together — reused by both the
 * feed's job cards and the detail page's summary header, so the "always three separate numbers/
 * labels, never combined" rule (docs/JOB_DISCOVERY.md "Match/Coverage/Eligibility presentation")
 * has exactly one implementation to keep honest. No star ratings, no percentage-as-color-fill,
 * no "Perfect match"/"Bad match" language — plain labeled numbers plus the eligibility badge.
 *
 * Match and Coverage are given deliberately different visual weight (Match large/bold, Coverage
 * smaller/secondary with a qualitative High/Medium/Low band from the same `getCoverageBucket`
 * the ranking itself already uses) so a low-evidence 100% Match can't visually read as a
 * confident one — without combining the two numbers or introducing a color/star scale.
 */
export function MatchCoverageEligibility({
  matchScore,
  coverage,
  eligibilityStatus,
}: {
  matchScore: number;
  coverage: number;
  eligibilityStatus: EligibilityStatus;
}) {
  const lowCoverage = isLowCoverage(coverage);
  const coverageBand = COVERAGE_BAND_LABELS[getCoverageBucket(coverage)];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-xs">Match</span>
          <span className="text-lg font-semibold tracking-tight">{Math.round(matchScore)}%</span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="text-muted-foreground text-xs">Coverage</span>
          <span className="text-muted-foreground text-sm">{coverageBand}</span>
          <span className="text-muted-foreground text-sm">·</span>
          <span className="text-muted-foreground text-sm">{Math.round(coverage)}%</span>
          {lowCoverage ? (
            <span className="bg-status-action/15 text-status-action rounded-full px-2 py-0.5 text-xs font-medium">
              Limited data
            </span>
          ) : null}
        </span>
        <EligibilityBadge status={eligibilityStatus} />
      </div>
      {lowCoverage ? (
        <p className="text-muted-foreground text-xs">
          Limited job data — this posting didn&apos;t give Career OS enough information to
          evaluate most of what Match is based on, so the score above reflects very little.
        </p>
      ) : null}
    </div>
  );
}
