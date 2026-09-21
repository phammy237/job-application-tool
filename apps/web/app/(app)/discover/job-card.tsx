import { Card, CardContent, CardHeader } from '@career-os/ui';
import { selectJobApplyActions, type DiscoveryFeedResultItem } from '@career-os/shared';
import Link from 'next/link';
import { EMPLOYMENT_LABELS, WORKPLACE_LABELS } from './discovery-display-labels';
import { MatchCoverageEligibility } from './match-coverage-eligibility';
import { StartApplicationButton } from './start-application-button';

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
  const applyActions = selectJobApplyActions(job);

  return (
    <Card>
      <CardHeader className="pb-2">
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
      <CardContent className="space-y-2 pt-0">
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{WORKPLACE_LABELS[job.normalizedWorkplaceType] ?? 'Workplace unknown'}</span>
          {/* `isInternship` is the canonical classification (broader than
              normalizedEmploymentType === 'INTERNSHIP' alone — see discovery-feed-result.ts) — a
              card that only matched the Internship filter via this broader signal must still say
              "Internship", never a raw "Full-time"/"Employment type unknown" that contradicts the
              very filter that surfaced it. normalizedEmploymentType itself is never mutated. */}
          <span>
            {job.isInternship
              ? EMPLOYMENT_LABELS.INTERNSHIP
              : (EMPLOYMENT_LABELS[job.normalizedEmploymentType] ?? 'Employment type unknown')}
          </span>
        </div>
        <MatchCoverageEligibility
          matchScore={job.matchScore}
          coverage={job.coverage}
          eligibilityStatus={job.eligibilityStatus}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {applyActions.primary ? (
            <a
              href={applyActions.primary.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {applyActions.primary.label} →
            </a>
          ) : (
            <a
              href={applyActions.fallbackSearchUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Find official posting →
            </a>
          )}
          {applyActions.sourceUrl ? (
            <a
              href={applyActions.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground text-xs hover:underline"
            >
              View source
            </a>
          ) : null}
        </div>
        <StartApplicationButton
          jobCatalogId={job.jobCatalogId}
          trackedApplicationId={job.trackedApplicationId}
          trackedApplicationStatus={job.trackedApplicationStatus}
        />
      </CardContent>
    </Card>
  );
}
