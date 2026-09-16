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
  eligibilityProfile?: DiscoveryEligibilityProfile;
  jobs?: ScorableJob[];
}) {
  const spies = [
    vi
      .spyOn(database, 'getOrCreateOwnScoringProfile')
      .mockResolvedValue(options.scoringProfile ?? baseScoringProfile()),
    vi
      .spyOn(database, 'getOrCreateOwnEligibilityProfile')
      .mockResolvedValue(options.eligibilityProfile ?? baseEligibilityProfile()),
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

/**
 * D5B's core invariant, proved directly against the real orchestrator (not a UI-level or API-
 * route-level mock) — see docs/JOB_DISCOVERY.md "Scoring/Eligibility independence" and the D5B
 * spec's "CORE INVARIANT" section. Both tests hold the job/features fixed and vary only one
 * profile at a time, run `rankJobsForUser` twice, and assert the *other* output is byte-for-byte
 * (`toBe`/`toEqual`) identical across the two runs — not "close," not "similar," identical.
 */
describe('D5B independence invariants', () => {
  // Deliberately produces a real, non-trivial CONFLICT (not just "no checks apply") so a test
  // that failed to actually vary eligibility would be caught — a job silently stuck on ELIGIBLE
  // both times would make the invariant vacuous rather than proven.
  const sponsorshipConflictFeatures = baseFeatures({ sponsorshipSignal: 'NOT_AVAILABLE' });
  const noRequirementsEligibility = baseEligibilityProfile();
  const sponsorshipRequiredEligibility: DiscoveryEligibilityProfile = {
    ...baseEligibilityProfile(),
    requiresSponsorshipNow: true,
  };

  it('A: changing the eligibility profile, with scoring profile/job/features fixed, leaves Match and Coverage exactly unchanged', async () => {
    const jobs: ScorableJob[] = [
      { jobCatalogId: 'j1', companyName: 'Acme', firstSeenAt: '2026-01-01T00:00:00.000Z', features: sponsorshipConflictFeatures },
    ];
    const now = new Date('2026-01-02T00:00:00.000Z');

    const spiesRunA = mockDependencies({ eligibilityProfile: noRequirementsEligibility, jobs });
    await rankJobsForUser(FAKE_SUPABASE, USER_ID, now);
    const entriesRunA = (
      database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![2];
    for (const spy of spiesRunA) spy.mockRestore();

    const spiesRunB = mockDependencies({ eligibilityProfile: sponsorshipRequiredEligibility, jobs });
    await rankJobsForUser(FAKE_SUPABASE, USER_ID, now);
    const entriesRunB = (
      database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![2];
    for (const spy of spiesRunB) spy.mockRestore();

    // Sanity: the eligibility profile change actually took effect — otherwise this test would
    // trivially pass without ever exercising the invariant it claims to prove.
    expect(entriesRunA[0].eligibilityStatus).toBe('ELIGIBLE');
    expect(entriesRunB[0].eligibilityStatus).toBe('CONFLICT');

    // The invariant itself: Match and Coverage are untouched by the eligibility change.
    expect(entriesRunB[0].matchScore).toBe(entriesRunA[0].matchScore);
    expect(entriesRunB[0].coverage).toBe(entriesRunA[0].coverage);
  });

  it('B: changing the scoring profile, with eligibility profile/job/features fixed, leaves Eligibility exactly unchanged', async () => {
    const jobs: ScorableJob[] = [
      { jobCatalogId: 'j1', companyName: 'Acme', firstSeenAt: '2026-01-01T00:00:00.000Z', features: sponsorshipConflictFeatures },
    ];
    const now = new Date('2026-01-02T00:00:00.000Z');
    const highRoleFitProfile = baseScoringProfile({
      criteriaWeights: { ROLE_FIT: 10, COMPETENCY_FIT: 0, SENIORITY_FIT: 0, LOCATION_FIT: 0, WORK_MODE_FIT: 0, EMPLOYMENT_TYPE_FIT: 0, OBSERVED_FRESHNESS: 0 },
      rolePreferences: { SOFTWARE_ENGINEERING: 10 },
    });
    const lowRoleFitProfile = baseScoringProfile({
      criteriaWeights: { ROLE_FIT: 10, COMPETENCY_FIT: 0, SENIORITY_FIT: 0, LOCATION_FIT: 0, WORK_MODE_FIT: 0, EMPLOYMENT_TYPE_FIT: 0, OBSERVED_FRESHNESS: 0 },
      rolePreferences: { SOFTWARE_ENGINEERING: 2 },
    });

    const spiesRunA = mockDependencies({
      scoringProfile: highRoleFitProfile,
      eligibilityProfile: sponsorshipRequiredEligibility,
      jobs,
    });
    await rankJobsForUser(FAKE_SUPABASE, USER_ID, now);
    const entriesRunA = (
      database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![2];
    for (const spy of spiesRunA) spy.mockRestore();

    const spiesRunB = mockDependencies({
      scoringProfile: lowRoleFitProfile,
      eligibilityProfile: sponsorshipRequiredEligibility,
      jobs,
    });
    await rankJobsForUser(FAKE_SUPABASE, USER_ID, now);
    const entriesRunB = (
      database.upsertUserJobMatchScoresBatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![2];
    for (const spy of spiesRunB) spy.mockRestore();

    // Sanity: the scoring profile change actually took effect.
    expect(entriesRunA[0].matchScore).toBe(100);
    expect(entriesRunB[0].matchScore).toBe(20);
    expect(entriesRunA[0].matchScore).not.toBe(entriesRunB[0].matchScore);

    // The invariant itself: eligibility status AND the full per-check breakdown are untouched by
    // the scoring change — not just the aggregate status, the entire checks array.
    expect(entriesRunB[0].eligibilityStatus).toBe(entriesRunA[0].eligibilityStatus);
    expect(entriesRunB[0].eligibilityChecks).toEqual(entriesRunA[0].eligibilityChecks);
  });
});
