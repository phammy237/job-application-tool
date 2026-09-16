import { describe, expect, it } from 'vitest';
import { computeDiscoverySettingsChanges } from './discovery-settings-diff';
import type { DiscoveryEligibilityProfile } from '../schemas/discovery-eligibility-profile';
import type { DiscoveryScoringProfile } from '../schemas/discovery-scoring-profile';
import type { DiscoverySettingsRequest } from '../schemas/discovery-settings-request';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function scoringProfile(overrides: Partial<DiscoveryScoringProfile> = {}): DiscoveryScoringProfile {
  return {
    userId: USER_ID,
    profileVersion: 'v1',
    preset: 'CUSTOM',
    criteriaWeights: {
      ROLE_FIT: 8,
      COMPETENCY_FIT: 6,
      SENIORITY_FIT: 0,
      LOCATION_FIT: 5,
      WORK_MODE_FIT: 7,
      EMPLOYMENT_TYPE_FIT: 3,
      OBSERVED_FRESHNESS: 2,
    },
    rolePreferences: { SOFTWARE_ENGINEERING: 10, DATA_SCIENCE: 6 },
    seniorityPreferences: {},
    locationPreferences: { NEW_YORK_NY: 'PREFERRED' },
    workModePreferences: { REMOTE: 10 },
    employmentTypePreferences: { FULL_TIME: 10 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function eligibilityProfile(
  overrides: Partial<DiscoveryEligibilityProfile> = {},
): DiscoveryEligibilityProfile {
  return {
    userId: USER_ID,
    currentlyAuthorizedToWork: true,
    requiresSponsorshipNow: false,
    requiresSponsorshipFuture: true,
    isUsCitizen: false,
    hasActiveSecurityClearance: null,
    eligibleToObtainSecurityClearance: null,
    graduationYear: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function requestFrom(
  scoring: DiscoveryScoringProfile,
  eligibility: DiscoveryEligibilityProfile,
): DiscoverySettingsRequest {
  return {
    scoring: {
      preset: scoring.preset,
      criteriaWeights: scoring.criteriaWeights,
      rolePreferences: scoring.rolePreferences,
      seniorityPreferences: scoring.seniorityPreferences,
      locationPreferences: scoring.locationPreferences,
      workModePreferences: scoring.workModePreferences,
      employmentTypePreferences: scoring.employmentTypePreferences,
    },
    eligibility: {
      currentlyAuthorizedToWork: eligibility.currentlyAuthorizedToWork,
      requiresSponsorshipNow: eligibility.requiresSponsorshipNow,
      requiresSponsorshipFuture: eligibility.requiresSponsorshipFuture,
      isUsCitizen: eligibility.isUsCitizen,
      hasActiveSecurityClearance: eligibility.hasActiveSecurityClearance,
      eligibleToObtainSecurityClearance: eligibility.eligibleToObtainSecurityClearance,
      graduationYear: eligibility.graduationYear,
    },
  };
}

describe('computeDiscoverySettingsChanges', () => {
  it('detects no change when the request exactly matches the current profiles (true no-op)', () => {
    const scoring = scoringProfile();
    const eligibility = eligibilityProfile();
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(scoring, eligibility),
    );
    expect(result).toEqual({ scoringChanged: false, eligibilityChanged: false });
  });

  it('ignores server-derived fields (userId, profileVersion, createdAt, updatedAt) — a resubmit with a stale updatedAt is still a no-op', () => {
    const scoring = scoringProfile({ updatedAt: '2020-01-01T00:00:00.000Z' });
    const eligibility = eligibilityProfile({ updatedAt: '2020-01-01T00:00:00.000Z' });
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(scoringProfile(), eligibilityProfile()),
    );
    expect(result).toEqual({ scoringChanged: false, eligibilityChanged: false });
  });

  it('is order-independent for jsonb preference maps — {A,B} vs {B,A} is not a change', () => {
    const scoring = scoringProfile({
      rolePreferences: { SOFTWARE_ENGINEERING: 10, DATA_SCIENCE: 6 },
    });
    const request = requestFrom(
      scoringProfile({ rolePreferences: { DATA_SCIENCE: 6, SOFTWARE_ENGINEERING: 10 } }),
      eligibilityProfile(),
    );
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility: eligibilityProfile() },
      request,
    );
    expect(result.scoringChanged).toBe(false);
  });

  it('detects a scoring-only change (a single weight) and leaves eligibilityChanged false', () => {
    const scoring = scoringProfile();
    const eligibility = eligibilityProfile();
    const nextScoring = scoringProfile({
      criteriaWeights: { ...scoring.criteriaWeights, ROLE_FIT: 9 },
    });
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(nextScoring, eligibility),
    );
    expect(result).toEqual({ scoringChanged: true, eligibilityChanged: false });
  });

  it('detects an eligibility-only change and leaves scoringChanged false', () => {
    const scoring = scoringProfile();
    const eligibility = eligibilityProfile();
    const nextEligibility = eligibilityProfile({ isUsCitizen: true });
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(scoring, nextEligibility),
    );
    expect(result).toEqual({ scoringChanged: false, eligibilityChanged: true });
  });

  it('detects when both profiles changed', () => {
    const scoring = scoringProfile();
    const eligibility = eligibilityProfile();
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(
        scoringProfile({ preset: 'BALANCED' }),
        eligibilityProfile({ graduationYear: 2027 }),
      ),
    );
    expect(result).toEqual({ scoringChanged: true, eligibilityChanged: true });
  });

  it('treats removing a preference entirely (back to UNKNOWN) as a change, distinct from rating it 0', () => {
    const scoring = scoringProfile({ workModePreferences: { REMOTE: 10 } });
    const withRemoved = scoringProfile({ workModePreferences: {} });
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility: eligibilityProfile() },
      requestFrom(withRemoved, eligibilityProfile()),
    );
    expect(result.scoringChanged).toBe(true);
  });

  it('treats a null-to-value eligibility change (answering a previously-unknown field) as a change', () => {
    const scoring = scoringProfile();
    const eligibility = eligibilityProfile({ hasActiveSecurityClearance: null });
    const result = computeDiscoverySettingsChanges(
      { scoring, eligibility },
      requestFrom(scoring, eligibilityProfile({ hasActiveSecurityClearance: true })),
    );
    expect(result).toEqual({ scoringChanged: false, eligibilityChanged: true });
  });
});
