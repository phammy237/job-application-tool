/**
 * D7.1 — bounded Official Posting Resolution. Runs as its own stage in the daily workflow, after
 * `discovery:enrich-jobright` (title/company should be settled first) and before `discovery:rank`
 * (resolution never affects Match/Coverage, but keeps `canonical_apply_url` fresh before any D6
 * snapshot could read it). README ingestion and enrichment must keep working independently of
 * this stage, so a failure here never touches the workflow's overall exit code.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TAVILY_API_KEY=... \
 *     npx vite-node scripts/discovery/resolve-official-postings.ts \
 *       [--max <n>] [--retry-days <n>] [--dry-run]
 */
import { createSupabaseAdminClient, listAllJobSources } from '@career-os/database';
import { runOfficialPostingResolution } from '@career-os/discovery';

interface CliArgs {
  max?: number;
  retryDays?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const maxRaw = get('--max');
  const retryDaysRaw = get('--retry-days');
  return {
    max: maxRaw ? Number(maxRaw) : undefined,
    retryDays: retryDaysRaw ? Number(retryDaysRaw) : undefined,
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();

  const allSources = await listAllJobSources(supabase);
  const jobrightSourceIds = allSources
    .filter((source) => source.sourceType === 'JOBRIGHT_GITHUB')
    .map((source) => source.id);
  const atsSourceIds = allSources
    .filter((source) => source.sourceType !== 'JOBRIGHT_GITHUB')
    .map((source) => source.id);

  if (jobrightSourceIds.length === 0) {
    console.log('No JOBRIGHT_GITHUB sources registered — nothing to resolve.');
    return;
  }

  const retryAfterMs = (args.retryDays ?? 14) * 24 * 60 * 60 * 1000;
  const maxCount = args.max ?? 30;

  if (args.dryRun) {
    console.log(
      `[dry-run] would attempt up to ${maxCount} resolution(s) across ${jobrightSourceIds.length} Jobright source(s), retry window ${args.retryDays ?? 14} day(s).`,
    );
    console.log('Dry run — no search calls, no fetches, no changes written.');
    return;
  }

  const summary = await runOfficialPostingResolution(
    supabase,
    { jobrightSourceIds, atsSourceIds },
    { retryAfterMs, maxCount },
  );

  console.log('');
  console.log('=== Official Posting Resolution Summary ===');
  console.log(`Attempted: ${summary.attempted}`);
  console.log(`Merged into existing ATS catalog row: ${summary.mergedIntoAts}`);
  console.log(`Resolved (high confidence, via search): ${summary.resolvedHighConfidence}`);
  console.log(`Resolved (review candidate stored, canonical untouched): ${summary.resolvedReview}`);
  console.log(`Unresolved: ${summary.unresolved}`);
  for (const outcome of summary.outcomes) {
    console.log(`  [${outcome.outcome}] ${outcome.jobCatalogId} — ${outcome.detail}`);
  }

  // A search/liveness failure for one job is expected/bounded and must never fail the workflow —
  // README ingestion and enrichment already succeeded independently by the time this stage runs.
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
