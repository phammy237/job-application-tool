/**
 * D7 §9-10 — bounded Jobright detail-page enrichment. Runs as its own stage, always AFTER
 * `discovery:sync` and BEFORE `discovery:rank` in the daily workflow
 * (.github/workflows/job-discovery-sync.yml) — README ingestion must keep working independently
 * of this stage, so a failure here never touches sync's own exit code.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/enrich-jobright.ts [--max <n>] [--stale-days <n>] [--dry-run]
 */
import {
  createSupabaseAdminClient,
  listAllJobSources,
  listJobrightEnrichmentCandidates,
} from '@career-os/database';
import { runJobrightEnrichment } from '@career-os/discovery';

interface CliArgs {
  max?: number;
  staleDays?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const maxRaw = get('--max');
  const staleDaysRaw = get('--stale-days');
  return {
    max: maxRaw ? Number(maxRaw) : undefined,
    staleDays: staleDaysRaw ? Number(staleDaysRaw) : undefined,
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

  if (jobrightSourceIds.length === 0) {
    console.log('No JOBRIGHT_GITHUB sources registered — nothing to enrich.');
    return;
  }

  const staleAfterMs = args.staleDays ? args.staleDays * 24 * 60 * 60 * 1000 : undefined;
  const maxPerRun = args.max;

  if (args.dryRun) {
    const candidates = await listJobrightEnrichmentCandidates(supabase, jobrightSourceIds, {
      staleAfterMs: staleAfterMs ?? 14 * 24 * 60 * 60 * 1000,
      maxCount: maxPerRun ?? 30,
    });
    console.log(`[dry-run] ${candidates.length} candidate(s) would be enriched:`);
    for (const candidate of candidates) {
      console.log(`[dry-run]   ${candidate.jobCatalogId} -> ${candidate.applyUrl}`);
    }
    console.log('Dry run — no fetches performed, no changes written.');
    return;
  }

  const summary = await runJobrightEnrichment(supabase, jobrightSourceIds, {
    staleAfterMs,
    maxPerRun,
  });

  console.log('');
  console.log('=== Jobright Enrichment Summary ===');
  console.log(`Attempted: ${summary.attempted}`);
  console.log(`Succeeded: ${summary.succeeded}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Failed: ${summary.failed}`);
  for (const result of summary.results) {
    if (result.outcome !== 'ENRICHED') {
      console.log(`  [${result.outcome}] ${result.jobCatalogId} — ${result.reason ?? 'no reason given'}`);
    }
  }

  // Enrichment failures are expected/bounded (a stale detail page, a transient 500) and must never
  // fail the workflow the way an all-sources-failed `discovery:sync` run does — README ingestion
  // already succeeded independently by the time this stage runs.
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
