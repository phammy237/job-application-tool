/**
 * Manual/on-demand job discovery sync (docs/JOB_DISCOVERY.md "Manual ingestion command") — also
 * the exact script the daily GitHub Actions workflow runs
 * (.github/workflows/job-discovery-sync.yml). Zero Claude/Tavily/embedding calls anywhere in this
 * path (docs/JOB_DISCOVERY.md "AI/search call audit").
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/sync.ts [--source <id>] [--provider GREENHOUSE] \
 *       [--limit <n>] [--dry-run]
 */
import { createSupabaseAdminClient, listEnabledJobSourcesDueForCrawl } from '@career-os/database';
import { runDiscoverySync, type SourceSyncResult } from '@career-os/discovery';
import { jobSourceTypeSchema, type JobSourceType } from '@career-os/shared';

interface CliArgs {
  sourceId?: string;
  provider?: JobSourceType;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const providerRaw = get('--provider');
  const provider = providerRaw ? jobSourceTypeSchema.parse(providerRaw) : undefined;

  const limitRaw = get('--limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    throw new Error(`--limit must be a positive integer, got "${limitRaw}"`);
  }

  return { sourceId: get('--source'), provider, limit, dryRun: argv.includes('--dry-run') };
}

function logSourceResult(result: SourceSyncResult): void {
  const prefix = `[${result.outcome}] ${result.companyName} (${result.provider}, ${result.sourceId}) — ${result.durationMs}ms`;
  if (result.outcome === 'SUCCESS') {
    console.log(
      `${prefix} fetched=${result.jobsFetched} new=${result.new} updated=${result.updated} ` +
        `unchanged=${result.unchanged} possiblyClosed=${result.possiblyClosed} closed=${result.closed} ` +
        `reopened=${result.reopened} rejected=${result.rejected}`,
    );
  } else {
    console.error(`${prefix} error=${result.error}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();

  // A failure here (e.g. Supabase credentials entirely invalid) is deliberately NOT caught by
  // any per-source isolation — it propagates, crashes this script, and fails the run
  // (docs/JOB_DISCOVERY.md "Failure isolation": "Supabase authentication completely invalid:
  // fail the run").
  let sources = await listEnabledJobSourcesDueForCrawl(supabase, {
    sourceId: args.sourceId,
    provider: args.provider,
  });
  if (args.limit) sources = sources.slice(0, args.limit);

  console.log(`Sources due for crawl: ${sources.length}`);

  if (args.dryRun) {
    for (const source of sources) {
      console.log(
        `[dry-run] would sync ${source.sourceType}:${source.sourceIdentifier} (${source.companyName})`,
      );
    }
    console.log('Dry run — no crawl performed, no changes written.');
    return;
  }

  const summary = await runDiscoverySync(supabase, sources, { onSourceResult: logSourceResult });

  console.log('');
  console.log('=== Job Discovery Sync Summary ===');
  console.log(`Sources attempted: ${summary.sourcesAttempted}`);
  console.log(`Successful: ${summary.sourcesSucceeded}`);
  console.log(`Failed: ${summary.sourcesFailed}`);
  console.log('');
  console.log(`Jobs fetched: ${summary.jobsFetched}`);
  console.log(`New: ${summary.new}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Unchanged: ${summary.unchanged}`);
  console.log(`Possibly closed: ${summary.possiblyClosed}`);
  console.log(`Closed: ${summary.closed}`);
  console.log(`Reopened: ${summary.reopened}`);
  console.log(`Malformed/rejected: ${summary.rejected}`);

  // One broken company must never fail the whole run (docs/JOB_DISCOVERY.md "Failure
  // isolation") — but every attempted source failing is exactly the systemic case (e.g. a
  // config/credentials problem surfacing on every write) that must fail loudly, never silently
  // report "0 jobs synced" as if the run were healthy.
  if (summary.sourcesAttempted > 0 && summary.sourcesSucceeded === 0) {
    console.error('\nEvery attempted source failed — treating this run as a systemic failure.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
