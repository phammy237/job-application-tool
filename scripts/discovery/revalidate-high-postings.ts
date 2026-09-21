/**
 * Re-validates already-stored RESOLVED_HIGH_CONFIDENCE official postings against the current final
 * page-identity confirmation. No search (Tavily is never called), one bounded page fetch per stored
 * canonical_apply_url, downgrades only — see `official-posting-revalidation.ts`.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/revalidate-high-postings.ts [--max <n>] [--dry-run]
 */
import { createSupabaseAdminClient, listAllJobSources } from '@career-os/database';
import { runOfficialPostingRevalidation } from '@career-os/discovery';

const DEFAULT_MAX = 100;
const MAX_ALLOWED = 500;

function parseArgs(argv: string[]): { max: number; dryRun: boolean } {
  const index = argv.indexOf('--max');
  let max = DEFAULT_MAX;
  if (index !== -1) {
    const raw = argv[index + 1];
    const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ALLOWED) {
      throw new Error(`--max must be an integer between 1 and ${MAX_ALLOWED} (got "${raw ?? ''}")`);
    }
    max = parsed;
  }
  return { max, dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();

  const jobrightSourceIds = (await listAllJobSources(supabase))
    .filter((source) => source.sourceType === 'JOBRIGHT_GITHUB')
    .map((source) => source.id);
  if (jobrightSourceIds.length === 0) {
    console.log('No JOBRIGHT_GITHUB sources registered — nothing to revalidate.');
    return;
  }

  const summary = await runOfficialPostingRevalidation(supabase, { jobrightSourceIds }, args);

  console.log('');
  console.log(`=== Official Posting HIGH Revalidation${args.dryRun ? ' (DRY RUN — no writes)' : ''} ===`);
  console.log(`Checked: ${summary.checked}`);
  console.log(`Unchanged (still HIGH): ${summary.unchanged}`);
  console.log(`Demoted to REVIEW: ${summary.demotedToReview}`);
  console.log(`Demoted to UNRESOLVED: ${summary.demotedToUnresolved}`);
  console.log(`Link failures recorded (unreachable, two-strike): ${summary.linkFailuresRecorded}`);
  console.log(`By page-check outcome: ${JSON.stringify(summary.byOutcome)}`);
  for (const row of summary.rows) {
    const redirect = row.redirectedToHost ? ` [redirected to ${row.redirectedToHost}]` : '';
    console.log(
      `  [${row.outcome}/${row.action}] ${row.jobCatalogId} — ${row.companyName} | ${row.title.slice(0, 70)} | ${row.url}${redirect} — ${row.reason}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
