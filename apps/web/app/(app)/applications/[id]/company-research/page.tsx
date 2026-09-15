import {
  getOwnApplication,
  getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication,
} from '@career-os/database';
import {
  buildCompanyResearchSummary,
  type CompanyResearchFinding,
  type CompanyResearchSource,
} from '@career-os/shared';
import { Badge } from '@career-os/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';
import { ResearchCompanyButton } from '../../research-company-button';

const CATEGORY_LABEL: Record<string, string> = {
  PRODUCT: 'Product',
  STRATEGY: 'Strategy',
  TECHNOLOGY: 'Technology',
  BUSINESS: 'Business',
  CULTURE: 'Culture',
  HIRING: 'Hiring',
  RECENT_DEVELOPMENT: 'Recent development',
  OTHER: 'Other',
};

/**
 * The dedicated company-research view (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §47) — read-only,
 * server-rendered. `?snapshot=<id>` selects a specific historical snapshot; omitted, it shows the
 * latest. Nothing on this page ever triggers research generation — the only action here is
 * `ResearchCompanyButton` ("Refresh research"), same explicit-click-only posture as the
 * application detail page's embedded section.
 */
export default async function CompanyResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ snapshot?: string }>;
}) {
  const { id: applicationId } = await params;
  const { snapshot: requestedSnapshotId } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const application = await getOwnApplication(supabase, user.id, applicationId);
  if (!application) {
    notFound();
  }

  const summaries = await listOwnCompanyResearchSnapshotsForApplication(
    supabase,
    user.id,
    applicationId,
  );
  const selectedId = requestedSnapshotId ?? summaries[0]?.id ?? null;

  const snapshot = selectedId
    ? await getOwnCompanyResearchSnapshot(supabase, user.id, selectedId)
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/applications/${applicationId}`}
          className="text-primary text-xs hover:underline"
        >
          ← Back to application
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Company Research</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {application.company} — {application.title}
        </p>
      </div>

      {!snapshot ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            No research yet for this application.
          </p>
          <ResearchCompanyButton applicationId={applicationId} label="Research company" />
        </div>
      ) : (
        <SnapshotView snapshot={snapshot} applicationId={applicationId} />
      )}

      {summaries.length > 1 ? (
        <div className="space-y-2 border-t pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            Previous research
          </h2>
          <ul className="space-y-1">
            {summaries.map((s) => (
              <li key={s.id} className="text-sm">
                <Link
                  href={`/applications/${applicationId}/company-research?snapshot=${s.id}`}
                  className={
                    s.id === selectedId ? 'font-medium' : 'text-primary hover:underline'
                  }
                >
                  {formatDate(s.researchedAt)}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {' '}
                  — {s.findingCount} finding{s.findingCount === 1 ? '' : 's'} ·{' '}
                  {s.sourceCount} source
                  {s.sourceCount === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotView({
  snapshot,
  applicationId,
}: {
  snapshot: {
    researchedAt: string;
    findings: CompanyResearchFinding[];
    sources: CompanyResearchSource[];
  };
  applicationId: string;
}) {
  const summary = buildCompanyResearchSummary(snapshot.findings);
  const sourceIndexById = new Map(snapshot.sources.map((s, i) => [s.id, i + 1]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Researched {formatDate(snapshot.researchedAt)}
        </p>
        <ResearchCompanyButton applicationId={applicationId} label="Refresh research" />
      </div>

      {summary ? (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide">Summary</h2>
          <p className="text-sm">{summary}</p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Findings</h2>
        {snapshot.findings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No findings in this snapshot.</p>
        ) : (
          <ul className="space-y-3">
            {snapshot.findings.map((finding) => (
              <li
                key={finding.id}
                className="border-border rounded-lg border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">
                    {CATEGORY_LABEL[finding.category] ?? finding.category}
                  </Badge>
                </div>
                <p className="mt-1">
                  {finding.claim}{' '}
                  {finding.sources.map((s) => (
                    <sup key={s.id}>
                      <a
                        href={`#source-${sourceIndexById.get(s.id)}`}
                        className="text-primary"
                      >
                        [{sourceIndexById.get(s.id)}]
                      </a>
                    </sup>
                  ))}
                </p>
                {finding.roleRelevance ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    <span className="font-medium">Role relevance:</span>{' '}
                    {finding.roleRelevance}
                  </p>
                ) : null}
                {finding.requirementIds.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Relevant to {finding.requirementIds.length} job requirement
                    {finding.requirementIds.length === 1 ? '' : 's'}.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Sources</h2>
        <ol className="space-y-2">
          {snapshot.sources.map((source, i) => (
            <li key={source.id} id={`source-${i + 1}`} className="text-sm">
              <span className="text-muted-foreground text-xs">[{i + 1}]</span>{' '}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {source.title}
              </a>
              <span className="text-muted-foreground text-xs">
                {' '}
                — {source.publisher ?? 'unknown publisher'}
                {source.publishedAt ? ` · ${formatDate(source.publishedAt)}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
