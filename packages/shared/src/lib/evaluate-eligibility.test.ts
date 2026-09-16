import { describe, expect, it } from 'vitest';
import {
  evaluateEligibility,
  type EligibilityEvaluationFeatures,
  type EligibilityEvaluationProfile,
} from './evaluate-eligibility';

const BASE_FEATURES: EligibilityEvaluationFeatures = {
  sponsorshipSignal: 'UNKNOWN',
  citizenshipRequirement: 'UNKNOWN',
  clearanceRequirement: 'UNKNOWN',
  workAuthorizationRequirement: 'UNKNOWN',
  graduationYearMin: null,
  graduationYearMax: null,
  evidence: {},
};

const BASE_PROFILE: EligibilityEvaluationProfile = {
  currentlyAuthorizedToWork: null,
  requiresSponsorshipNow: null,
  requiresSponsorshipFuture: null,
  isUsCitizen: null,
  hasActiveSecurityClearance: null,
  eligibleToObtainSecurityClearance: null,
  graduationYear: null,
};

describe('evaluateEligibility — SPONSORSHIP', () => {
  it('explicit no sponsorship + user needs future sponsorship -> CONFLICT', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'NOT_AVAILABLE' },
      { ...BASE_PROFILE, requiresSponsorshipFuture: true },
    );
    expect(result.overallStatus).toBe('CONFLICT');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ type: 'SPONSORSHIP', status: 'CONFLICT' });
  });

  it('explicit sponsorship available + user needs sponsorship -> ELIGIBLE', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'AVAILABLE' },
      { ...BASE_PROFILE, requiresSponsorshipNow: true },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
    expect(result.checks[0]).toMatchObject({ type: 'SPONSORSHIP', status: 'ELIGIBLE' });
  });

  it('silence -> UNKNOWN', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'UNKNOWN' },
      { ...BASE_PROFILE, requiresSponsorshipFuture: true },
    );
    expect(result.overallStatus).toBe('UNKNOWN');
    expect(result.checks[0]).toMatchObject({ type: 'SPONSORSHIP', status: 'UNKNOWN' });
  });

  it('no sponsorship needed by user + restrictive sponsorship statement -> no conflict (check omitted)', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'NOT_AVAILABLE' },
      { ...BASE_PROFILE, requiresSponsorshipNow: false, requiresSponsorshipFuture: false },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
    expect(result.checks).toHaveLength(0);
  });

  it('current work authorization and future sponsorship are evaluated as separate checks', () => {
    const result = evaluateEligibility(
      {
        ...BASE_FEATURES,
        sponsorshipSignal: 'NOT_AVAILABLE',
        workAuthorizationRequirement: 'AUTHORIZATION_REQUIRED',
      },
      {
        ...BASE_PROFILE,
        currentlyAuthorizedToWork: true, // authorized right now (e.g. via OPT)
        requiresSponsorshipFuture: true, // but will need sponsorship later
      },
    );
    const sponsorship = result.checks.find((c) => c.type === 'SPONSORSHIP');
    const workAuth = result.checks.find((c) => c.type === 'WORK_AUTHORIZATION');
    expect(sponsorship?.status).toBe('CONFLICT');
    expect(workAuth?.status).toBe('ELIGIBLE');
    expect(result.overallStatus).toBe('CONFLICT');
  });
});

describe('evaluateEligibility — CITIZENSHIP', () => {
  it('explicit US-citizen-only + non-citizen self-report -> CONFLICT', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, citizenshipRequirement: 'US_CITIZEN_ONLY' },
      { ...BASE_PROFILE, isUsCitizen: false },
    );
    expect(result.overallStatus).toBe('CONFLICT');
  });

  it('no citizenship wording -> check omitted (not applicable)', () => {
    const result = evaluateEligibility(BASE_FEATURES, { ...BASE_PROFILE, isUsCitizen: false });
    expect(result.checks.find((c) => c.type === 'CITIZENSHIP')).toBeUndefined();
    expect(result.overallStatus).toBe('ELIGIBLE');
  });

  it('citizenship required + user has not answered -> check omitted', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, citizenshipRequirement: 'US_CITIZEN_ONLY' },
      BASE_PROFILE,
    );
    expect(result.checks.find((c) => c.type === 'CITIZENSHIP')).toBeUndefined();
  });
});

describe('evaluateEligibility — SECURITY_CLEARANCE', () => {
  it('explicit active clearance required + user lacks clearance -> CONFLICT', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, clearanceRequirement: 'ACTIVE_CLEARANCE_REQUIRED' },
      { ...BASE_PROFILE, hasActiveSecurityClearance: false },
    );
    expect(result.overallStatus).toBe('CONFLICT');
  });

  it('eligibility to obtain clearance does NOT satisfy an active-clearance requirement', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, clearanceRequirement: 'ACTIVE_CLEARANCE_REQUIRED' },
      { ...BASE_PROFILE, hasActiveSecurityClearance: false, eligibleToObtainSecurityClearance: true },
    );
    expect(result.overallStatus).toBe('CONFLICT');
    expect(result.checks[0]?.reasonCode).toBe('CLEARANCE_ACTIVE_REQUIRED_BUT_USER_LACKS_ACTIVE');
  });

  it('an eligibility-to-obtain posting is satisfied by eligibility (not requiring an active clearance)', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, clearanceRequirement: 'CLEARANCE_ELIGIBILITY_REQUIRED' },
      { ...BASE_PROFILE, eligibleToObtainSecurityClearance: true },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
  });

  it('an active clearance also satisfies an eligibility-to-obtain posting', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, clearanceRequirement: 'CLEARANCE_ELIGIBILITY_REQUIRED' },
      { ...BASE_PROFILE, hasActiveSecurityClearance: true },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
  });
});

describe('evaluateEligibility — GRADUATION_WINDOW', () => {
  it('explicit accepted window + matching year -> ELIGIBLE', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, graduationYearMin: 2027, graduationYearMax: 2028 },
      { ...BASE_PROFILE, graduationYear: 2028 },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
  });

  it('explicit incompatible window -> CONFLICT', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, graduationYearMin: 2027, graduationYearMax: 2028 },
      { ...BASE_PROFILE, graduationYear: 2030 },
    );
    expect(result.overallStatus).toBe('CONFLICT');
  });

  it('absent graduation window -> check omitted (not applicable)', () => {
    const result = evaluateEligibility(BASE_FEATURES, { ...BASE_PROFILE, graduationYear: 2028 });
    expect(result.checks.find((c) => c.type === 'GRADUATION_WINDOW')).toBeUndefined();
    expect(result.overallStatus).toBe('ELIGIBLE');
  });
});

describe('evaluateEligibility — aggregation', () => {
  it('any conflict makes overall CONFLICT even with other eligible/unknown checks', () => {
    const result = evaluateEligibility(
      {
        ...BASE_FEATURES,
        sponsorshipSignal: 'AVAILABLE',
        citizenshipRequirement: 'US_CITIZEN_ONLY',
      },
      { ...BASE_PROFILE, requiresSponsorshipNow: true, isUsCitizen: false },
    );
    expect(result.overallStatus).toBe('CONFLICT');
  });

  it('an unresolved relevant check with no conflict makes overall UNKNOWN', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'UNKNOWN' },
      { ...BASE_PROFILE, requiresSponsorshipNow: true },
    );
    expect(result.overallStatus).toBe('UNKNOWN');
  });

  it('all applicable checks pass -> ELIGIBLE', () => {
    const result = evaluateEligibility(
      { ...BASE_FEATURES, sponsorshipSignal: 'AVAILABLE', citizenshipRequirement: 'US_CITIZEN_ONLY' },
      { ...BASE_PROFILE, requiresSponsorshipNow: true, isUsCitizen: true },
    );
    expect(result.overallStatus).toBe('ELIGIBLE');
  });

  it('a user with zero eligibility profile answers gets ELIGIBLE for every job (vacuous, documented)', () => {
    const result = evaluateEligibility(
      {
        ...BASE_FEATURES,
        sponsorshipSignal: 'NOT_AVAILABLE',
        citizenshipRequirement: 'US_CITIZEN_ONLY',
        clearanceRequirement: 'ACTIVE_CLEARANCE_REQUIRED',
        graduationYearMin: 2027,
        graduationYearMax: 2028,
      },
      BASE_PROFILE,
    );
    expect(result.checks).toHaveLength(0);
    expect(result.overallStatus).toBe('ELIGIBLE');
  });
});
