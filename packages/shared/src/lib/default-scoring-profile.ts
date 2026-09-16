import type { CriteriaWeights } from '../schemas/discovery-scoring-profile';

/**
 * The BALANCED preset's default criterion importances (docs/JOB_DISCOVERY.md "Discovery Scoring
 * Profile") — a transparent, fully editable starting point, not a claim that these weights are
 * objectively correct for any user. Mirrored as the literal column default in migration
 * `0030_job_discovery_ranking.sql` so a row created directly at the database layer (bypassing
 * this constant) still gets the same values; this constant exists for the few call sites
 * (get-or-create query, CLI defaults) that need the same numbers in application code.
 *
 * OBSERVED_FRESHNESS is deliberately the smallest weight by default (docs/JOB_DISCOVERY.md
 * "Observed freshness": freshness should remain a relatively small ranking factor). Role
 * family/location/work-mode/employment-type *preferences* are NOT defaulted here — Career OS has
 * no basis to guess what role families or locations a specific user wants, so those start empty
 * (every value UNKNOWN until the user or `scripts/discovery/set-profile.ts` sets them) rather
 * than a fabricated default opinion.
 */
export const BALANCED_PRESET_CRITERIA_WEIGHTS: CriteriaWeights = {
  ROLE_FIT: 7,
  COMPETENCY_FIT: 7,
  SENIORITY_FIT: 6,
  LOCATION_FIT: 6,
  WORK_MODE_FIT: 5,
  EMPLOYMENT_TYPE_FIT: 5,
  OBSERVED_FRESHNESS: 3,
};
