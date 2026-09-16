import { describe, expect, it } from 'vitest';
import { evaluateCriteria, type EvaluateCriteriaFeatures, type EvaluateCriteriaProfile } from './evaluate-criteria';

const BASE_FEATURES: EvaluateCriteriaFeatures = {
  roleFamily: 'UNKNOWN',
  seniority: 'UNKNOWN',
  normalizedEmploymentType: 'UNKNOWN',
  normalizedWorkplaceType: 'UNKNOWN',
  locationTokens: [],
  extractedCompetencyCodes: [],
};

const BASE_PROFILE: EvaluateCriteriaProfile = {
  rolePreferences: {},
  seniorityPreferences: {},
  locationPreferences: {},
  workModePreferences: {},
  employmentTypePreferences: {},
};

const NOW = new Date('2026-01-31T00:00:00.000Z');
const RECENT_FIRST_SEEN = '2026-01-30T00:00:00.000Z';

function find(evaluations: ReturnType<typeof evaluateCriteria>['evaluations'], criterion: string) {
  return evaluations.find((e) => e.criterion === criterion);
}

describe('evaluateCriteria — ROLE_FIT', () => {
  it('is UNKNOWN when the job role family is UNKNOWN', () => {
    const result = evaluateCriteria({
      features: BASE_FEATURES,
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: BASE_PROFILE,
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'ROLE_FIT')?.fit).toBeNull();
  });

  it('is UNKNOWN when the job role is known but the user never rated it', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, roleFamily: 'SOFTWARE_ENGINEERING' },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, rolePreferences: { PRODUCT_MANAGEMENT: 10 } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'ROLE_FIT')?.fit).toBeNull();
  });

  it('is the user rating / 10 when both are known', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, roleFamily: 'PRODUCT_MANAGEMENT' },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, rolePreferences: { PRODUCT_MANAGEMENT: 8 } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'ROLE_FIT')?.fit).toBe(0.8);
  });
});

describe('evaluateCriteria — COMPETENCY_FIT', () => {
  it('is UNKNOWN when the job has zero extracted concepts', () => {
    const result = evaluateCriteria({
      features: BASE_FEATURES,
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: BASE_PROFILE,
      candidateCompetencyCodes: ['SQL'],
    });
    expect(find(result.evaluations, 'COMPETENCY_FIT')?.fit).toBeNull();
  });

  it('is the overlap ratio of job concepts covered by the candidate', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, extractedCompetencyCodes: ['SQL', 'PYTHON', 'ROADMAP'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: BASE_PROFILE,
      candidateCompetencyCodes: ['SQL', 'PYTHON'],
    });
    expect(find(result.evaluations, 'COMPETENCY_FIT')?.fit).toBeCloseTo(2 / 3);
  });

  it('is 0 (known, not unknown) when the candidate matches nothing the job asks for', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, extractedCompetencyCodes: ['SQL'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: BASE_PROFILE,
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'COMPETENCY_FIT')?.fit).toBe(0);
  });
});

describe('evaluateCriteria — LOCATION_FIT', () => {
  it('is UNKNOWN when the job has no location tokens', () => {
    const result = evaluateCriteria({
      features: BASE_FEATURES,
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { NEW_YORK_NY: 'PREFERRED' } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'LOCATION_FIT')?.fit).toBeNull();
  });

  it('is UNKNOWN when the job has tokens but none are rated by the user', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['LONDON_UNITED_KINGDOM'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { NEW_YORK_NY: 'PREFERRED' } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'LOCATION_FIT')?.fit).toBeNull();
    expect(result.excludedByLocationPreference).toBe(false);
  });

  it('uses the documented constants for PREFERRED/ACCEPTABLE/AVOID', () => {
    const preferred = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['NEW_YORK_NY'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { NEW_YORK_NY: 'PREFERRED' } },
      candidateCompetencyCodes: [],
    });
    expect(find(preferred.evaluations, 'LOCATION_FIT')?.fit).toBe(1.0);

    const acceptable = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['NEW_YORK_NY'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { NEW_YORK_NY: 'ACCEPTABLE' } },
      candidateCompetencyCodes: [],
    });
    expect(find(acceptable.evaluations, 'LOCATION_FIT')?.fit).toBe(0.7);

    const avoid = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['NEW_YORK_NY'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { NEW_YORK_NY: 'AVOID' } },
      candidateCompetencyCodes: [],
    });
    expect(find(avoid.evaluations, 'LOCATION_FIT')?.fit).toBe(0.2);
  });

  it('EXCLUDE is a hard filter: fit is null and excludedByLocationPreference is true', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['SAN_FRANCISCO_CA'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, locationPreferences: { SAN_FRANCISCO_CA: 'EXCLUDE' } },
      candidateCompetencyCodes: [],
    });
    expect(result.excludedByLocationPreference).toBe(true);
    expect(find(result.evaluations, 'LOCATION_FIT')?.fit).toBeNull();
  });

  it('a multi-location job is not excluded unless one of ITS tokens is excluded', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, locationTokens: ['NEW_YORK_NY', 'SAN_FRANCISCO_CA'] },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: {
        ...BASE_PROFILE,
        locationPreferences: { NEW_YORK_NY: 'PREFERRED', SEATTLE_WA: 'EXCLUDE' },
      },
      candidateCompetencyCodes: [],
    });
    expect(result.excludedByLocationPreference).toBe(false);
    expect(find(result.evaluations, 'LOCATION_FIT')?.fit).toBe(1.0);
  });
});

describe('evaluateCriteria — WORK_MODE_FIT / EMPLOYMENT_TYPE_FIT', () => {
  it('WORK_MODE_FIT is UNKNOWN when workplace type is UNKNOWN', () => {
    const result = evaluateCriteria({
      features: BASE_FEATURES,
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, workModePreferences: { REMOTE: 10 } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'WORK_MODE_FIT')?.fit).toBeNull();
  });

  it('WORK_MODE_FIT reflects the user rating when known', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, normalizedWorkplaceType: 'REMOTE' },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, workModePreferences: { REMOTE: 10 } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'WORK_MODE_FIT')?.fit).toBe(1.0);
  });

  it('EMPLOYMENT_TYPE_FIT never penalizes a null (UNKNOWN) employment type', () => {
    const result = evaluateCriteria({
      features: { ...BASE_FEATURES, normalizedEmploymentType: 'UNKNOWN' },
      firstSeenAt: RECENT_FIRST_SEEN,
      now: NOW,
      profile: { ...BASE_PROFILE, employmentTypePreferences: { FULL_TIME: 10 } },
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'EMPLOYMENT_TYPE_FIT')?.fit).toBeNull();
  });
});

describe('evaluateCriteria — OBSERVED_FRESHNESS', () => {
  it('is always known (never null)', () => {
    const result = evaluateCriteria({
      features: BASE_FEATURES,
      firstSeenAt: '2009-12-05T00:00:00.000Z',
      now: NOW,
      profile: BASE_PROFILE,
      candidateCompetencyCodes: [],
    });
    expect(find(result.evaluations, 'OBSERVED_FRESHNESS')?.fit).not.toBeNull();
  });
});
