import {
  listOwnCompanyResearchSnapshotsForApplication,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import Link from 'next/link';
import { ResearchCompanyButton } from './research-company-button';

/**
 * The application detail page's "Company Research" section (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7G" §46) — server-rendered, same pattern as `ResumeSection`: reads already-persisted
 * state directly (no client-side fetch-on-mount), and the one client component embedded here
 * (`ResearchCompanyButton`) makes its own single POST only on explicit click, never automatically.
 */
export async function CompanyResearchSection({
  supabase,
  userId,
  applicationId,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  applicationId: string;
}) {
  const snapshots = await listOwnCompanyResearchSnapshotsForApplication(
    supabase,
    userId,
    applicationId,
  );
  const latest = snapshots[0] ?? null;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">Company Research</h2>

      {latest ? (
        <div className="border-border space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">{latest.companyName}</p>
          <p className="text-muted-foreground text-xs">
            Last researched {formatDate(latest.researchedAt)} — {latest.findingCount}{' '}
            finding
            {latest.findingCount === 1 ? '' : 's'} · {latest.sourceCount} source
            {latest.sourceCount === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/applications/${applicationId}/company-research`}
              className="text-primary text-xs hover:underline"
            >
              View research
            </Link>
            <ResearchCompanyButton
              applicationId={applicationId}
              label="Refresh research"
            />
          </div>
          {snapshots.length > 1 ? (
            <p className="text-muted-foreground text-xs">
              {snapshots.length - 1} earlier research snapshot
              {snapshots.length - 1 === 1 ? '' : 's'} — see the full history on the
              research page.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Research current company priorities, products, and developments relevant to
            this role.
          </p>
          <ResearchCompanyButton applicationId={applicationId} label="Research company" />
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
