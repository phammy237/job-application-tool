import { Card, CardContent, CardHeader } from '@career-os/ui';
import type { DiscoveryFeedResultItem } from '@career-os/shared';
import Link from 'next/link';
import { MatchCoverageEligibility } from './match-coverage-eligibility';
import { StartApplicationButton } from './start-application-button';

const WORKPLACE_LABELS: Record<string, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
};

/** "New today" / "X days ago" — same hand-rolled relative-date approach as
 * `network/page.tsx`'s `formatFollowUpLabel`, not a new date-formatting dependency. */
function formatFirstSeenLabel(firstSeenAt: string, now: Date): string {
  const seenDate = new Date(firstSeenAt);
  const days = Math.floor((now.getTime() - seenDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'New today';
  if (days === 1) return 'Posted 1 day ago';
  return `Posted ${days} days ago`;
}

export function JobCard({ job, now }: { job: DiscoveryFeedResultItem; now: Date }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href={`/discover/${job.jobCatalogId}`}
              className="hover:text-primary font-medium hover:underline"
            >
              {job.title}
            </Link>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {job.companyName}
              {job.locationText ? ` · ${job.locationText}` : ''}
            </p>
          </div>
          <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
            {formatFirstSeenLabel(job.firstSeenAt, now)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{WORKPLACE_LABELS[job.normalizedWorkplaceType] ?? 'Workplace unknown'}</span>
          <span>{EMPLOYMENT_LABELS[job.normalizedEmploymentType] ?? 'Employment type unknown'}</span>
        </div>
        <MatchCoverageEligibility
          matchScore={job.matchScore}
          coverage={job.coverage}
          eligibilityStatus={job.eligibilityStatus}
        />
        <StartApplicationButton
          jobCatalogId={job.jobCatalogId}
          trackedApplicationId={job.trackedApplicationId}
          trackedApplicationStatus={job.trackedApplicationStatus}
        />
      </CardContent>
    </Card>
  );
}
