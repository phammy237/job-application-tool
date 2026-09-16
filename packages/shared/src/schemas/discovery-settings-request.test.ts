import { describe, expect, it } from 'vitest';
import { discoverySettingsRequestSchema } from './discovery-settings-request';

const VALID_SCORING = {
  preset: 'CUSTOM' as const,
  criteriaWeights: {
    ROLE_FIT: 8,
    COMPETENCY_FIT: 6,
    SENIORITY_FIT: 0,
    LOCATION_FIT: 5,
    WORK_MODE_FIT: 7,
    EMPLOYMENT_TYPE_FIT: 3,
    OBSERVED_FRESHNESS: 2,
  },
  rolePreferences: { SOFTWARE_ENGINEERING: 10 },
  seniorityPreferences: {},
  locationPreferences: { NEW_YORK_NY: 'PREFERRED' as const },
  workModePreferences: { REMOTE: 10 },
  employmentTypePreferences: { FULL_TIME: 10 },
};

const VALID_ELIGIBILITY = {
  currentlyAuthorizedToWork: true,
  requiresSponsorshipNow: false,
  requiresSponsorshipFuture: null,
  isUsCitizen: null,
  hasActiveSecurityClearance: null,
  eligibleToObtainSecurityClearance: null,
  graduationYear: 2026,
};

// Deep-cloned on every call — several tests below mutate the returned object directly to build
// an invalid variant, and VALID_SCORING/VALID_ELIGIBILITY must stay pristine for every other test.
function validRequest(): { scoring: typeof VALID_SCORING; eligibility: typeof VALID_ELIGIBILITY } {
  return structuredClone({ scoring: VALID_SCORING, eligibility: VALID_ELIGIBILITY });
}

describe('discoverySettingsRequestSchema', () => {
  it('accepts a fully valid request', () => {
    expect(discoverySettingsRequestSchema.safeParse(validRequest()).success).toBe(true);
  });

  it('strips server-derived fields rather than requiring or rejecting them', () => {
    const withExtra = {
      scoring: { ...VALID_SCORING, userId: 'x', profileVersion: 'v1' },
      eligibility: { ...VALID_ELIGIBILITY, userId: 'x' },
    };
    const parsed = discoverySettingsRequestSchema.safeParse(withExtra);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scoring).not.toHaveProperty('userId');
      expect(parsed.data.scoring).not.toHaveProperty('profileVersion');
    }
  });

  it('rejects a weight above 10', () => {
    const req = validRequest();
    req.scoring.criteriaWeights.ROLE_FIT = 11;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects a negative weight', () => {
    const req = validRequest();
    req.scoring.criteriaWeights.ROLE_FIT = -1;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects a non-integer weight', () => {
    const req = validRequest();
    (req.scoring.criteriaWeights as Record<string, number>).ROLE_FIT = 5.5;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects an unrecognized scoring criterion key', () => {
    const req = validRequest();
    (req.scoring.criteriaWeights as Record<string, number>).NOT_A_REAL_CRITERION = 5;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects an unrecognized role family', () => {
    const req = validRequest();
    (req.scoring.rolePreferences as Record<string, number>).NOT_A_REAL_FAMILY = 5;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects an unrecognized location preference category', () => {
    const req = validRequest();
    (req.scoring.locationPreferences as Record<string, string>).NEW_YORK_NY = 'LOVE_IT';
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects an unrecognized preset', () => {
    const req = validRequest();
    (req.scoring as Record<string, unknown>).preset = 'MADE_UP';
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects a graduationYear outside the sane [2000, 2100] range', () => {
    const req = validRequest();
    req.eligibility.graduationYear = 1500;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('rejects a non-boolean eligibility field', () => {
    const req = validRequest();
    (req.eligibility as Record<string, unknown>).isUsCitizen = 'yes';
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('accepts null for every nullable eligibility field (never forces an answer)', () => {
    const req = {
      scoring: VALID_SCORING,
      eligibility: {
        currentlyAuthorizedToWork: null,
        requiresSponsorshipNow: null,
        requiresSponsorshipFuture: null,
        isUsCitizen: null,
        hasActiveSecurityClearance: null,
        eligibleToObtainSecurityClearance: null,
        graduationYear: null,
      },
    };
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(true);
  });

  it('rejects a request missing the scoring key entirely', () => {
    expect(
      discoverySettingsRequestSchema.safeParse({ eligibility: VALID_ELIGIBILITY }).success,
    ).toBe(false);
  });

  it('rejects a request missing a required scoring field (e.g. criteriaWeights)', () => {
    const req = validRequest();
    delete (req.scoring as Partial<typeof VALID_SCORING>).criteriaWeights;
    expect(discoverySettingsRequestSchema.safeParse(req).success).toBe(false);
  });

  it('never throws on a completely malformed payload shape', () => {
    expect(() => discoverySettingsRequestSchema.safeParse(null)).not.toThrow();
    expect(() => discoverySettingsRequestSchema.safeParse(undefined)).not.toThrow();
    expect(() => discoverySettingsRequestSchema.safeParse('not an object')).not.toThrow();
    expect(() => discoverySettingsRequestSchema.safeParse([1, 2, 3])).not.toThrow();
    expect(() => discoverySettingsRequestSchema.safeParse({ scoring: null, eligibility: 5 })).not.toThrow();
  });
});
