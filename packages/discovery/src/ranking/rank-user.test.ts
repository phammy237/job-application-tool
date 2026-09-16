import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient, ScorableJob } from '@career-os/database';
import * as database from '@career-os/database';
import type { DiscoveryEligibilityProfile, DiscoveryScoringProfile } from '@career-os/shared';
import { rankJobsForUser } from './rank-user';

const FAKE_SUPABASE = {} as CareerOsSupabaseClient;
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function baseScoringProfile(overrides: Partial<DiscoveryScoringProfile> = {}): DiscoveryScoringProfile {
  return {
    userId: USER_ID,
    profileVersion: 'v1',
    preset: 'BALANCED',
    criteriaWeights: { ROLE_FIT: 10, COMPETENCY_FIT: 0, SENIORITY_FIT: 0, LOCATION_FIT: 10, WORK_MODE_FIT: 0, EMPLOYMENT_TYPE_FIT: 0, OBSERVED_FRESHNESS: 0 },
    rolePreferences: { SOFTWARE_ENGINEERING: 10 },
    seniorityPreferences: {},
    locationPreferences: { NEW_YORK_NY: 'PREFERRED' },
    workModePreferences: {},
    employmentTypePreferences: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseEligibilityProfile(): DiscoveryEligibilityProfile {
  return {
    userId: USER_ID,
    currentlyAuthorizedToWork: null,
    requiresSponsorshipNow: null,
    requiresSponsorshipFuture: null,
    isUsCitizen: null,
    hasActiveSecurityClearance: null,
    eligibleToObtainSecurityClearance: null,
    graduationYear: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function baseFeatures(overrides: Partial<ScorableJob['features']> = {}): ScorableJob['features'] {
  return {
    id: 'ffffffff-0000-4000-8000-000000000001',
    jobCatalogId: 'j1',
    contentHashAtExtraction: 'v1:h',
    plainTextDescription: '',
    roleFamily: 'SOFTWARE_ENGINEERING',
    seniority: 'UNKNOWN',
    isInternship: false,
    isNewGrad: false,
    normalizedEmploymentType: 'UNKNOWN',
    normalizedWorkplaceType: 'UNKNOWN',
    locationTokens: ['NEW_YORK_NY'],
    extractedCompetencyCodes: [],
    requiredYearsMin: null,
    requiredYearsMax: null,
    graduationYearMin: null,
    graduationYearMax: null,
    sponsorshipSignal: 'UNKNOWN',
    citizenshipRequirement: 'UNKNOWN',
    clearanceRequirement: 'UNKNOWN',
    workAuthorizationRequirement: 'UNKNOWN',
    evidence: {},
    featureVersion: 'd4-features-v1',
    computedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockDependencies(options: {
  scoringProfile?: DiscoveryScoringProfile;
  jobs?: ScorableJob[];
}) {
  const spies = [
    vi
      .spyOn(database, 'getOrCreateOwnScoringProfile')
      .mockResolvedValue(options.scoringProfile ?? baseScoringProfile()),
    vi.spyOn(database, 'getOrCreateOwnEligibilityProfile').mockResolvedValue(baseEligibilityProfile()),
    vi.spyOn(database, 'deriveOwnCandidateCompetencyCodes').mockResolvedValue([]),
    vi.spyOn(database, 'listActiveJobsWithFeatures').mockResolvedValue(options.jobs ?? []),
    vi.spyOn(database, 'upsertUserJobMatchScoresBatch').mockResolvedValue(undefined),
  ];
  return spies;
}

describe('rankJobsForUser', () => {
  it('scores a normal job and persists it', async () => {
    const jobs: ScorableJob[] = [
      { jobCatalogId: 'j1', companyName: 'Acme', firstSeenAt: '2026-01-01T00:00:00.000Z', features: baseFeatures() },
    ];
    const spies = mockDependencies({ jobs });

    const summary = await rankJobsForUser(FAKE_SUPABASE, USER_ID, new Date('2026-01-02T00:00:00.000Z'));

    expect(summary).toEqual({
      userId: USER_ID,
      jobsConsidered: 1,
      jobsScored: 1,
      jobsExcludedByLocationPreference: 0,
    });

    const upsertSpy = database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>;
    const [, , entries] = upsertSpy.mock.calls[0]!;
    expect(entries).toHaveLength(1);
    expect(entries[0].matchScore).toBe(100); // ROLE_FIT 1.0 and LOCATION_FIT 1.0 (PREFERRED), both weight 10
    expect(entries[0].rankingVersion).toBe('d4-ranking-v1');

    for (const spy of spies) spy.mockRestore();
  });

  it('excludes a job matching an EXCLUDE location preference from scoring entirely', async () => {
    const jobs: ScorableJob[] = [
      {
        jobCatalogId: 'j2',
        companyName: 'Acme',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        features: baseFeatures({ jobCatalogId: 'j2', locationTokens: ['SAN_FRANCISCO_CA'] }),
      },
    ];
    const scoringProfile = baseScoringProfile({
      locationPreferences: { SAN_FRANCISCO_CA: 'EXCLUDE' },
    });
    const spies = mockDependencies({ scoringProfile, jobs });

    const summary = await rankJobsForUser(FAKE_SUPABASE, USER_ID);

    expect(summary.jobsConsidered).toBe(1);
    expect(summary.jobsScored).toBe(0);
    expect(summary.jobsExcludedByLocationPreference).toBe(1);

    const upsertSpy = database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>;
    const [, , entries] = upsertSpy.mock.calls[0]!;
    expect(entries).toEqual([]);

    for (const spy of spies) spy.mockRestore();
  });

  it('handles zero active jobs without error', async () => {
    const spies = mockDependencies({ jobs: [] });
    const summary = await rankJobsForUser(FAKE_SUPABASE, USER_ID);
    expect(summary).toEqual({
      userId: USER_ID,
      jobsConsidered: 0,
      jobsScored: 0,
      jobsExcludedByLocationPreference: 0,
    });
    for (const spy of spies) spy.mockRestore();
  });
});
