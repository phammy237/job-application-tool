import { getOwnPortfolioSettings } from '@career-os/database';
import { buildPortfolioExport } from '@career-os/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@career-os/ui';
import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { createClient } from '../../../../lib/supabase/server';
import { ApiKeyPanel, PortfolioSettingsForm } from './settings-forms';
import { countByVisibility } from './visibility-counts';

export const metadata = { title: 'Portfolio export' };

export default async function PortfolioSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [settings, graph] = await Promise.all([
    getOwnPortfolioSettings(supabase, user.id),
    loadEvidenceGraphForRequest(user.id),
  ]);

  const enabled = settings?.enabled ?? false;
  const preview = buildPortfolioExport(
    graph,
    { displayName: settings?.displayName ?? null, headline: settings?.headline ?? null },
    new Date(),
  );
  const previewJson = JSON.stringify(preview, null, 2);
  const counts = countByVisibility(graph);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio export</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Optionally let your own website read a small, public slice of your evidence.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What stays private</CardTitle>
          <CardDescription>
            Nothing leaves Career OS unless all three of these are true.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>You turned portfolio export on below (it is off by default).</li>
            <li>
              The item&apos;s visibility is set to Public. Private and Career OS only
              items are never exported.
            </li>
            <li>You approved the item.</li>
          </ol>
          <p className="text-muted-foreground mt-3 text-sm">
            Stories, candidates, your experience and education, evidence notes and private
            GitHub data are never exported. The preview below is exactly what the API
            would return right now.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Settings</CardTitle>
          <CardDescription>Status: {enabled ? 'enabled' : 'disabled'}</CardDescription>
        </CardHeader>
        <CardContent>
          <PortfolioSettingsForm
            enabled={enabled}
            displayName={settings?.displayName ?? ''}
            headline={settings?.headline ?? ''}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API key</CardTitle>
          <CardDescription>
            Your website sends this as <code>Authorization: Bearer …</code> to{' '}
            <code>/api/portfolio/v1</code>, from its server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyPanel hasKey={settings?.hasApiKey ?? false} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Visibility summary</CardTitle>
          <CardDescription>
            How many items sit at each level, and how many the export can include.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">Item counts by visibility</caption>
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Public
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Career OS only
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Private
                  </th>
                  <th scope="col" className="py-2 pl-3 font-medium">
                    In export
                  </th>
                </tr>
              </thead>
              <tbody>
                {counts.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {row.label}
                    </th>
                    <td className="px-3 py-2">{row.PUBLIC}</td>
                    <td className="px-3 py-2">{row.CAREER_OS_ONLY}</td>
                    <td className="px-3 py-2">{row.PRIVATE}</td>
                    <td className="py-2 pl-3">{row.note ?? row.exported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Export preview</CardTitle>
          <CardDescription>
            Read-only.{' '}
            {enabled
              ? 'This is what a valid key receives.'
              : 'Export is off, so the API currently returns nothing; this is what it would return once enabled.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre
            tabIndex={0}
            aria-label="Portfolio export JSON preview"
            className="bg-muted max-h-[32rem] overflow-auto rounded-md p-3 text-xs"
          >
            {previewJson}
          </pre>
          <p className="text-muted-foreground text-sm">
            Endpoint and schema details: <code>docs/myos/PORTFOLIO_API.md</code> in the
            repository.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
