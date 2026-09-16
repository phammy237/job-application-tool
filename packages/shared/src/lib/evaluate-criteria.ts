import { computeObservedFreshness } from './observed-freshness';
import type { CriterionEvaluation } from './match-score';
import type {
  DiscoveryScoringProfile,
  LocationPreferenceCategory,
} from '../schemas/discovery-scoring-profile';
import type { JobCatalogFeatures } from '../schemas/job-catalog-features';

const LOCATION_FIT_BY_CATEGORY: Record<Exclude<LocationPreferenceCategory, 'EXCLUDE'>, number> = {
  PREFERRED: 1.0,
  ACCEPTABLE: 0.7,
  AVOID: 0.2,
};

export type EvaluateCriteriaFeatures = Pick<
  JobCatalogFeatures,
  | 'roleFamily'
  | 'seniority'
  | 'normalizedEmploymentType'
  | 'normalizedWorkplaceType'
  | 'locationTokens'
  | 'extractedCompetencyCodes'
>;

export type EvaluateCriteriaProfile = Pick<
  DiscoveryScoringProfile,
  | 'rolePreferences'
  | 'seniorityPreferences'
  | 'locationPreferences'
  | 'workModePreferences'
  | 'employmentTypePreferences'
>;

export interface EvaluateCriteriaInput {
  features: EvaluateCriteriaFeatures;
  firstSeenAt: string;
  now: Date;
  profile: EvaluateCriteriaProfile;
  /** Every competency concept code the candidate's trusted, approved profile data supports
   * (skills/experiences/education/projects/candidate_facts — see docs/JOB_DISCOVERY.md
   * "Competency extraction"). */
  candidateCompetencyCodes: readonly string[];
}

export interface EvaluateCriteriaResult {
  evaluations: CriterionEvaluation[];
  /** True when the job matched a user EXCLUDE location preference — a hard personal filter, NOT
   * part of the numeric score (docs/JOB_DISCOVERY.md "User hard preference exclusions"). The
   * orchestrator must not persist a match-score row for this (user, job) pair when true. */
  excludedByLocationPreference: boolean;
}

/**
 * Turns one job's deterministic features + one user's scoring-profile preferences into the
 * per-criterion fit values `computeMatchScore` consumes (docs/JOB_DISCOVERY.md "Match-score
 * math"). Every "missing data never penalizes" rule lives here: a criterion is `fit: null`
 * (UNKNOWN, excluded from the match-score numerator/denominator but still counted in Coverage's
 * denominator when the criterion is enabled) whenever EITHER the job's relevant attribute is
 * itself UNKNOWN, OR the job's attribute is known but the user never expressed a preference for
 * that specific value — missing job data and missing user data are treated symmetrically.
 */
export function evaluateCriteria(input: EvaluateCriteriaInput): EvaluateCriteriaResult {
  const { features, firstSeenAt, now, profile, candidateCompetencyCodes } = input;

  const roleFit = lookupPreferenceFit(features.roleFamily, 'UNKNOWN', profile.rolePreferences);
  const seniorityFit = lookupPreferenceFit(features.seniority, 'UNKNOWN', profile.seniorityPreferences);
  const workModeFit = lookupPreferenceFit(
    features.normalizedWorkplaceType,
    'UNKNOWN',
    profile.workModePreferences,
  );
  const employmentTypeFit = lookupPreferenceFit(
    features.normalizedEmploymentType,
    'UNKNOWN',
    profile.employmentTypePreferences,
  );

  const jobCompetencyCount = features.extractedCompetencyCodes.length;
  const competencyFit: number | null =
    jobCompetencyCount === 0
      ? null
      : features.extractedCompetencyCodes.filter((code) => candidateCompetencyCodes.includes(code))
          .length / jobCompetencyCount;

  const { fit: locationFit, excluded: excludedByLocationPreference } = evaluateLocationFit(
    features.locationTokens,
    profile.locationPreferences,
  );

  const freshnessFit = computeObservedFreshness(firstSeenAt, now).fit;

  const evaluations: CriterionEvaluation[] = [
    { criterion: 'ROLE_FIT', fit: roleFit },
    { criterion: 'COMPETENCY_FIT', fit: competencyFit },
    { criterion: 'SENIORITY_FIT', fit: seniorityFit },
    { criterion: 'LOCATION_FIT', fit: excludedByLocationPreference ? null : locationFit },
    { criterion: 'WORK_MODE_FIT', fit: workModeFit },
    { criterion: 'EMPLOYMENT_TYPE_FIT', fit: employmentTypeFit },
    { criterion: 'OBSERVED_FRESHNESS', fit: freshnessFit },
  ];

  return { evaluations, excludedByLocationPreference };
}

/**
 * Shared logic for ROLE_FIT/SENIORITY_FIT/WORK_MODE_FIT/EMPLOYMENT_TYPE_FIT: `null` (UNKNOWN)
 * when the job's own classified value is the extractor's UNKNOWN sentinel, OR when it's a known
 * value but the user never rated that specific value in their 0-10 preference map — never an
 * implicit 0 in either case.
 */
function lookupPreferenceFit(
  value: string,
  unknownSentinel: string,
  preferences: Record<string, number>,
): number | null {
  if (value === unknownSentinel) return null;
  const rating = preferences[value];
  return rating === undefined ? null : rating / 10;
}

function evaluateLocationFit(
  locationTokens: readonly string[],
  locationPreferences: Record<string, LocationPreferenceCategory>,
): { fit: number | null; excluded: boolean } {
  if (locationTokens.length === 0) return { fit: null, excluded: false };

  const categories = locationTokens
    .map((token) => locationPreferences[token])
    .filter((category): category is LocationPreferenceCategory => category !== undefined);

  if (categories.includes('EXCLUDE')) return { fit: null, excluded: true };
  if (categories.length === 0) return { fit: null, excluded: false };
  if (categories.includes('PREFERRED')) return { fit: LOCATION_FIT_BY_CATEGORY.PREFERRED, excluded: false };
  if (categories.includes('ACCEPTABLE'))
    return { fit: LOCATION_FIT_BY_CATEGORY.ACCEPTABLE, excluded: false };
  return { fit: LOCATION_FIT_BY_CATEGORY.AVOID, excluded: false };
}
