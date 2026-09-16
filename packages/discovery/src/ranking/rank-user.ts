import {
  computeMatchScore,
  evaluateCriteria,
  evaluateEligibility,
  JOB_CATALOG_FEATURE_VERSION,
} from '@career-os/shared';
import {
  deriveOwnCandidateCompetencyCodes,
  getOrCreateOwnEligibilityProfile,
  getOrCreateOwnScoringProfile,
  listActiveJobsWithFeatures,
  upsertUserJobMatchScoresBatch,
  type CareerOsSupabaseClient,
  type MatchScoreUpsertEntry,
} from '@career-os/database';

/** Bump whenever the scoring MATH/criteria semantics change — distinct from
 * `JOB_CATALOG_FEATURE_VERSION` (extraction rules) and `ELIGIBILITY_VERSION` (eligibility rules)
 * (docs/JOB_DISCOVERY.md "Versioning"). */
export const RANKING_VERSION = 'd4-ranking-v1';
/** Bump whenever an eligibility check's evaluation rules change. */
export const ELIGIBILITY_VERSION = 'd4-eligibility-v1';

export interface RankUserSummary {
  userId: string;
  jobsConsidered: number;
  jobsScored: number;
  jobsExcludedByLocationPreference: number;
}

/**
 * Computes and persists `user_job_match_scores` for one user against every currently-ACTIVE job
 * in the catalog (docs/JOB_DISCOVERY.md "Match-score math" / "Eligibility"). Pure orchestration —
 * fetches the user's scoring/eligibility profiles and trusted competency evidence, fetches every
 * scorable job, and for each job: evaluates the seven criteria, computes Match Score + Coverage,
 * evaluates eligibility, and (unless the job is excluded by a hard EXCLUDE location preference —
 * docs/JOB_DISCOVERY.md "User hard preference exclusions", which removes it from consideration
 * entirely rather than scoring it) queues it for the batched upsert.
 *
 * Assumes `job_catalog_features` is already up to date — callers (the CLI) run
 * `extractFeaturesForStaleJobs` first so scoring never runs against stale features.
 */
export async function rankJobsForUser(
  supabase: CareerOsSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<RankUserSummary> {
  const [scoringProfile, eligibilityProfile, candidateCompetencyCodes, jobs] = await Promise.all([
    getOrCreateOwnScoringProfile(supabase, userId),
    getOrCreateOwnEligibilityProfile(supabase, userId),
    deriveOwnCandidateCompetencyCodes(supabase, userId),
    listActiveJobsWithFeatures(supabase),
  ]);

  const entries: MatchScoreUpsertEntry[] = [];
  let excludedByLocationPreferenceCount = 0;

  for (const job of jobs) {
    const { evaluations, excludedByLocationPreference } = evaluateCriteria({
      features: job.features,
      firstSeenAt: job.firstSeenAt,
      now,
      profile: scoringProfile,
      candidateCompetencyCodes,
    });

    if (excludedByLocationPreference) {
      excludedByLocationPreferenceCount += 1;
      continue;
    }

    const { matchScore, coverage, components } = computeMatchScore(
      scoringProfile.criteriaWeights,
      evaluations,
    );
    const eligibilityResult = evaluateEligibility(job.features, eligibilityProfile);

    entries.push({
      jobCatalogId: job.jobCatalogId,
      matchScore,
      coverage,
      eligibilityStatus: eligibilityResult.overallStatus,
      scoreComponents: components,
      eligibilityChecks: eligibilityResult.checks,
      rankingVersion: RANKING_VERSION,
      featureVersion: JOB_CATALOG_FEATURE_VERSION,
      eligibilityVersion: ELIGIBILITY_VERSION,
    });
  }

  await upsertUserJobMatchScoresBatch(supabase, userId, entries, now);

  return {
    userId,
    jobsConsidered: jobs.length,
    jobsScored: entries.length,
    jobsExcludedByLocationPreference: excludedByLocationPreferenceCount,
  };
}
