import { getOwnDiscoveryFeedJobDetail } from '@career-os/database';
import { isSafeExternalUrl } from '@career-os/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@career-os/ui';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { MatchCoverageEligibility } from '../match-coverage-eligibility';
import { EligibilityChecks } from './eligibility-checks';
import { MatchBreakdown } from './match-breakdown';

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

export default async function DiscoverJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const detail = await getOwnDiscoveryFeedJobDetail(supabase, user.id, id);
  if (!detail) {
    notFound();
  }
  const { job, features, matchScore } = detail;

  // Prefer the D4 canonical normalized values (features); job_catalog's own workplaceType/
  // employmentType are the raw, pre-normalization source values, used only as a fallback for the
  // rare case a job's features row hasn't been computed yet.
  const workplaceLabel = features
    ? (WORKPLACE_LABELS[features.normalizedWorkplaceType] ?? 'Workplace unknown')
    : (job.workplaceType ?? 'Workplace unknown');
  const employmentLabel = features
    ? (EMPLOYMENT_LABELS[features.normalizedEmploymentType] ?? 'Employment type unknown')
    : (job.employmentType ?? 'Employment type unknown');

  const originalPostingUrl = [job.sourceUrl, job.canonicalApplyUrl, job.applyUrl].find(
    (url): url is string => !!url && isSafeExternalUrl(url),
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        {job.status !== 'ACTIVE' ? (
          <Badge variant="outline">
            {job.status === 'CLOSED' ? 'This posting appears closed' : 'This posting may be closed'}
          </Badge>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="text-muted-foreground">
          {job.companyName}
          {job.locationText ? ` · ${job.locationText}` : ''}
        </p>
        <p className="text-muted-foreground text-sm">
          {workplaceLabel} · {employmentLabel}
        </p>
        {originalPostingUrl ? (
          <a
            href={originalPostingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-block text-sm hover:underline"
          >
            View original posting →
          </a>
        ) : (
          <p className="text-muted-foreground text-sm">
            No original posting link is available for this job.
          </p>
        )}
      </div>

      {matchScore ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Match, Coverage &amp; Eligibility</CardTitle>
            </CardHeader>
            <CardContent>
              <MatchCoverageEligibility
                matchScore={matchScore.matchScore}
                coverage={matchScore.coverage}
                eligibilityStatus={matchScore.eligibilityStatus}
              />
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="text-muted-foreground text-sm font-medium">Match breakdown</h2>
            <p className="text-muted-foreground text-sm">
              Each enabled criterion in your scoring profile is weighed against what this posting
              actually states. A criterion Career OS couldn&apos;t evaluate for this posting counts
              toward Coverage but not toward Match itself.
            </p>
            <MatchBreakdown components={matchScore.scoreComponents} />
          </section>

          <section className="space-y-2">
            <h2 className="text-muted-foreground text-sm font-medium">Eligibility</h2>
            <p className="text-muted-foreground text-sm">
              Eligibility is evaluated separately from Match — it reflects explicit legal/
              logistical requirements the posting states (sponsorship, work authorization,
              citizenship, clearance, graduation window), never years-of-experience or skill fit.
            </p>
            <EligibilityChecks checks={matchScore.eligibilityChecks} />
          </section>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Career OS hasn&apos;t scored this job against your profile yet.
        </p>
      )}

      {features?.plainTextDescription ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">About this role</h2>
          <p className="text-sm whitespace-pre-wrap">{features.plainTextDescription}</p>
        </section>
      ) : null}
    </div>
  );
}
