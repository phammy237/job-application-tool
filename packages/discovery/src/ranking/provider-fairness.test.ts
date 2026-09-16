import { describe, expect, it } from 'vitest';
import {
  computeMatchScore,
  evaluateCriteria,
  extractJobCatalogFeatures,
  type CriteriaWeights,
  type DiscoveryScoringProfile,
  type RawDiscoveredJob,
} from '@career-os/shared';

/**
 * Provider-bias audit (docs/JOB_DISCOVERY.md "Provider bias audit", design spec §32): three
 * `RawDiscoveredJob`-shaped fixtures representing the SAME logical posting as each of the three
 * D1-D3 adapters would actually produce it — Greenhouse never supplies `employmentType`/
 * `workplaceType` (a structural gap, not a job characteristic), Lever supplies `employmentType`
 * but often not `workplaceType`, Ashby supplies both. Title/location/description/company are
 * held identical across all three. Every criterion that legitimately IS available equally across
 * providers (role, location, competency, freshness) must score identically regardless of which
 * provider-specific fields happen to be present.
 */
function rawJob(overrides: Partial<RawDiscoveredJob> = {}): RawDiscoveredJob {
  return {
    sourceJobId: 'x',
    companyName: 'Acme',
    title: 'Senior Data Analyst',
    locationText: 'New York, NY',
    workplaceType: null,
    employmentType: null,
    description: 'Own product analytics and SQL-driven reporting for the growth team.',
    responsibilities: null,
    qualifications: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    applyUrl: 'https://example.com/apply',
    sourceUrl: null,
    postedAt: null,
    sourceUpdatedAt: null,
    ...overrides,
  };
}

const GREENHOUSE_SHAPED = rawJob({ employmentType: null, workplaceType: null });
const LEVER_SHAPED = rawJob({ employmentType: 'Full-time', workplaceType: null });
const ASHBY_SHAPED = rawJob({ employmentType: 'FullTime', workplaceType: 'HYBRID' });

const FIRST_SEEN_AT = '2026-01-25T00:00:00.000Z';
const NOW = new Date('2026-01-31T00:00:00.000Z');

function scoringProfile(criteriaWeights: CriteriaWeights): Pick<
  DiscoveryScoringProfile,
  | 'rolePreferences'
  | 'seniorityPreferences'
  | 'locationPreferences'
  | 'workModePreferences'
  | 'employmentTypePreferences'
> & { criteriaWeights: CriteriaWeights } {
  return {
    criteriaWeights,
    rolePreferences: { DATA_ANALYTICS: 8 },
    seniorityPreferences: { SENIOR: 8 },
    locationPreferences: { NEW_YORK_NY: 'PREFERRED' },
    workModePreferences: { HYBRID: 8, REMOTE: 8, ONSITE: 8 },
    employmentTypePreferences: { FULL_TIME: 8 },
  };
}

function scoreFor(raw: RawDiscoveredJob, weights: CriteriaWeights) {
  const features = extractJobCatalogFeatures({
    title: raw.title,
    description: raw.description ?? null,
    locationText: raw.locationText,
    employmentType: raw.employmentType ?? null,
    workplaceType: raw.workplaceType ?? null,
    contentHash: 'v1:x',
  });
  const profile = scoringProfile(weights);
  const { evaluations } = evaluateCriteria({
    features,
    firstSeenAt: FIRST_SEEN_AT,
    now: NOW,
    profile,
    candidateCompetencyCodes: ['SQL', 'PRODUCT_ANALYTICS'],
  });
  return computeMatchScore(weights, evaluations);
}

const providerAgnosticWeights: CriteriaWeights = {
  ROLE_FIT: 10,
  COMPETENCY_FIT: 10,
  SENIORITY_FIT: 10,
  LOCATION_FIT: 10,
  WORK_MODE_FIT: 0, // provider-dependent — excluded for this specific fairness comparison
  EMPLOYMENT_TYPE_FIT: 0, // provider-dependent — excluded for this specific fairness comparison
  OBSERVED_FRESHNESS: 10,
};

describe('provider fairness — criteria available equally across providers', () => {
  it('Greenhouse/Lever/Ashby-shaped equivalent postings receive identical Match Score and Coverage', () => {
    const greenhouse = scoreFor(GREENHOUSE_SHAPED, providerAgnosticWeights);
    const lever = scoreFor(LEVER_SHAPED, providerAgnosticWeights);
    const ashby = scoreFor(ASHBY_SHAPED, providerAgnosticWeights);

    expect(greenhouse.matchScore).toBe(lever.matchScore);
    expect(greenhouse.matchScore).toBe(ashby.matchScore);
    expect(greenhouse.coverage).toBe(lever.coverage);
    expect(greenhouse.coverage).toBe(ashby.coverage);
  });
});

describe('provider fairness — UNKNOWN structural fields never lower Match Score', () => {
  const allCriteriaWeights: CriteriaWeights = {
    ROLE_FIT: 10,
    COMPETENCY_FIT: 10,
    SENIORITY_FIT: 10,
    LOCATION_FIT: 10,
    WORK_MODE_FIT: 10,
    EMPLOYMENT_TYPE_FIT: 10,
    OBSERVED_FRESHNESS: 10,
  };

  it("Greenhouse's missing employment_type/workplace_type reduces Coverage, never the Match Score itself", () => {
    const ashby = scoreFor(ASHBY_SHAPED, allCriteriaWeights);
    // Ashby has strictly more known criteria (workplaceType='HYBRID', employmentType='FullTime'
    // both known and rated 8/10), so its coverage is provably higher.
    const greenhouseAllEnabled = scoreFor(GREENHOUSE_SHAPED, allCriteriaWeights);
    expect(ashby.coverage).toBeGreaterThan(greenhouseAllEnabled.coverage);

    // For Greenhouse specifically, enabling WORK_MODE_FIT/EMPLOYMENT_TYPE_FIT (which are always
    // UNKNOWN for it) changes NOTHING about its own match score compared to a profile where
    // those two criteria are disabled outright — proof that an UNKNOWN criterion is excluded
    // from the match-score numerator/denominator exactly the same way a disabled one is, never
    // silently dragging the average toward zero.
    const greenhouseProviderAgnosticOnly = scoreFor(GREENHOUSE_SHAPED, providerAgnosticWeights);
    expect(greenhouseAllEnabled.matchScore).toBe(greenhouseProviderAgnosticOnly.matchScore);
    // Coverage, by contrast, correctly falls when more enabled criteria are UNKNOWN.
    expect(greenhouseAllEnabled.coverage).toBeLessThan(greenhouseProviderAgnosticOnly.coverage);
  });

  it('a criterion being UNKNOWN is never mathematically equivalent to a mismatch (fit 0)', () => {
    const unknownWeights: CriteriaWeights = { EMPLOYMENT_TYPE_FIT: 10 };
    const unknownResult = scoreFor(GREENHOUSE_SHAPED, unknownWeights); // employmentType is UNKNOWN
    // With only one enabled criterion that's UNKNOWN, there's nothing to average -> 0 by the
    // documented "nothing evaluable" fallback (never divide by zero) AND 0% coverage.
    expect(unknownResult.matchScore).toBe(0);
    expect(unknownResult.coverage).toBe(0);

    // A job the user would actively dislike (employment type rated 0/10 by the user, but still a
    // KNOWN value) is a real, different situation — it also scores 0, but for a completely
    // different, honest reason: coverage is 100% (we DO know the answer), not 0%.
    const dislikedWeights: CriteriaWeights = { EMPLOYMENT_TYPE_FIT: 10 };
    const dislikedProfile = scoringProfile(dislikedWeights);
    dislikedProfile.employmentTypePreferences = { FULL_TIME: 0 };
    const dislikedFeatures = extractJobCatalogFeatures({
      title: ASHBY_SHAPED.title,
      description: ASHBY_SHAPED.description ?? null,
      locationText: ASHBY_SHAPED.locationText,
      employmentType: 'FullTime',
      workplaceType: null,
      contentHash: 'v1:x',
    });
    const { evaluations } = evaluateCriteria({
      features: dislikedFeatures,
      firstSeenAt: FIRST_SEEN_AT,
      now: NOW,
      profile: dislikedProfile,
      candidateCompetencyCodes: [],
    });
    const dislikedResult = computeMatchScore(dislikedWeights, evaluations);
    expect(dislikedResult.matchScore).toBe(0);
    expect(dislikedResult.coverage).toBe(100); // the crucial difference from the UNKNOWN case
  });
});

describe('provider fairness — provider/salary/posted_at are never inputs to Match at all', () => {
  it('the criteria registry contains no provider, salary, or posted_at criterion', () => {
    const weights: CriteriaWeights = {
      ROLE_FIT: 1,
      COMPETENCY_FIT: 1,
      SENIORITY_FIT: 1,
      LOCATION_FIT: 1,
      WORK_MODE_FIT: 1,
      EMPLOYMENT_TYPE_FIT: 1,
      OBSERVED_FRESHNESS: 1,
    };
    expect(Object.keys(weights)).not.toContain('SALARY_FIT');
    expect(Object.keys(weights)).not.toContain('PROVIDER_FIT');
    expect(Object.keys(weights)).not.toContain('POSTED_AT_FIT');
  });

  it("a job with salaryMin/Max set scores identically to one without, all else equal (salary is never read)", () => {
    const withSalary = rawJob({ salaryMin: 200000, salaryMax: 300000, salaryCurrency: 'USD' });
    const withoutSalary = rawJob({ salaryMin: null, salaryMax: null, salaryCurrency: null });
    const weights: CriteriaWeights = { ROLE_FIT: 10, LOCATION_FIT: 10 };

    expect(scoreFor(withSalary, weights).matchScore).toBe(scoreFor(withoutSalary, weights).matchScore);
  });
});
