import { isLowCoverage } from '@career-os/shared';
import type { EligibilityStatus } from '@career-os/shared';
import { EligibilityBadge } from './eligibility-badge';

/**
 * The one place Match, Coverage, and Eligibility are laid out together — reused by both the
 * feed's job cards and the detail page's summary header, so the "always three separate numbers/
 * labels, never combined" rule (docs/JOB_DISCOVERY.md "Match/Coverage/Eligibility presentation")
 * has exactly one implementation to keep honest. No star ratings, no percentage-as-color-fill,
 * no "Perfect match"/"Bad match" language — plain labeled numbers plus the eligibility badge.
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

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">Match</span>{' '}
          <span className="font-medium">{Math.round(matchScore)}%</span>
        </span>
        <span>
          <span className="text-muted-foreground">Coverage</span>{' '}
          <span className="font-medium">{Math.round(coverage)}%</span>
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
