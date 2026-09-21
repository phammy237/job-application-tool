/**
 * Recomputes `job_catalog_features` for every stale/missing job (docs/JOB_DISCOVERY.md
 * "Recomputation"). Zero Claude/Tavily/embedding calls — purely deterministic extraction.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/extract-features.ts
 */
import { createSupabaseAdminClient } from '@career-os/database';
import { extractFeaturesForStaleJobs } from '@career-os/discovery';

async function main(): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const summary = await extractFeaturesForStaleJobs(supabase);
  console.log(`Candidates needing (re)computation: ${summary.candidatesFound}`);
  console.log(`Features extracted/updated: ${summary.extracted}`);
  if (summary.failed > 0) {
    console.error(`Failed (isolated, other candidates unaffected): ${summary.failed}`);
    for (const failure of summary.failures) {
      console.error(`  - ${failure.jobCatalogId}: ${failure.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
