/**
 * Computes/recomputes `user_job_match_scores` (docs/JOB_DISCOVERY.md "Recomputation"). Always
 * extracts/refreshes `job_catalog_features` first (idempotent, cheap when nothing changed) so
 * scoring never runs against stale features. Zero Claude/Tavily/embedding calls.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/rank.ts [--user-id <uuid>]
 *
 * With no --user-id, ranks every user who already has a Discovery Scoring Profile (never a
 * hardcoded user id) — the bounded, real set of users this product currently has.
 */
import { createSupabaseAdminClient, listAllScoringProfiles } from '@career-os/database';
import { extractFeaturesForStaleJobs, rankJobsForUser } from '@career-os/discovery';

function parseArgs(argv: string[]): { userId?: string } {
  const index = argv.indexOf('--user-id');
  return { userId: index === -1 ? undefined : argv[index + 1] };
}

async function main(): Promise<void> {
  const { userId } = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();

  const featureSummary = await extractFeaturesForStaleJobs(supabase);
  console.log(
    `Feature extraction: ${featureSummary.candidatesFound} candidate(s), ${featureSummary.extracted} (re)computed.`,
  );
  if (featureSummary.failed > 0) {
    console.error(
      `Feature extraction: ${featureSummary.failed} candidate(s) failed (isolated, ranking continues):`,
    );
    for (const failure of featureSummary.failures) {
      console.error(`  - ${failure.jobCatalogId}: ${failure.reason}`);
    }
  }

  const userIds = userId
    ? [userId]
    : (await listAllScoringProfiles(supabase)).map((profile) => profile.userId);

  console.log(`Ranking for ${userIds.length} user(s).`);

  for (const id of userIds) {
    const summary = await rankJobsForUser(supabase, id);
    console.log(
      `[${summary.userId}] considered=${summary.jobsConsidered} scored=${summary.jobsScored} ` +
        `excludedByLocationPreference=${summary.jobsExcludedByLocationPreference}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
