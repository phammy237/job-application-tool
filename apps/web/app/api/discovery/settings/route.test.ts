import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getOrCreateOwnScoringProfile: vi.fn(),
  getOrCreateOwnEligibilityProfile: vi.fn(),
  updateOwnScoringProfile: vi.fn(),
  updateOwnEligibilityProfile: vi.fn(),
  rankJobsForUser: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOrCreateOwnScoringProfile: mocks.getOrCreateOwnScoringProfile,
  getOrCreateOwnEligibilityProfile: mocks.getOrCreateOwnEligibilityProfile,
  updateOwnScoringProfile: mocks.updateOwnScoringProfile,
  updateOwnEligibilityProfile: mocks.updateOwnEligibilityProfile,
}));
vi.mock('@career-os/discovery', () => ({ rankJobsForUser: mocks.rankJobsForUser }));
vi.mock('../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_CLIENT = { tag: 'session-scoped' };
const ADMIN_CLIENT = { tag: 'admin' };

const BASE_SCORING = {
  userId: USER_ID,
  profileVersion: 'v1',
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_ELIGIBILITY = {
  userId: USER_ID,
  currentlyAuthorizedToWork: true,
  requiresSponsorshipNow: false,
  requiresSponsorshipFuture: null,
  isUsCitizen: null,
  hasActiveSecurityClearance: null,
  eligibleToObtainSecurityClearance: null,
  graduationYear: 2026,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function requestBodyFrom(
  scoringOverrides: Record<string, unknown> = {},
  eligibilityOverrides: Record<string, unknown> = {},
) {
  const { userId: _u1, profileVersion: _pv, createdAt: _c1, updatedAt: _u2, ...scoring } = BASE_SCORING;
  const { userId: _u3, createdAt: _c2, updatedAt: _u4, ...eligibility } = BASE_ELIGIBILITY;
  return {
    scoring: { ...scoring, ...scoringOverrides },
    eligibility: { ...eligibility, ...eligibilityOverrides },
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/discovery/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.createAdminClient.mockReturnValue(ADMIN_CLIENT);
  mocks.getOrCreateOwnScoringProfile.mockResolvedValue(BASE_SCORING);
  mocks.getOrCreateOwnEligibilityProfile.mockResolvedValue(BASE_ELIGIBILITY);
  mocks.updateOwnScoringProfile.mockResolvedValue(BASE_SCORING);
  mocks.updateOwnEligibilityProfile.mockResolvedValue(BASE_ELIGIBILITY);
  mocks.rankJobsForUser.mockResolvedValue({
    userId: USER_ID,
    jobsConsidered: 1326,
    jobsScored: 1300,
    jobsExcludedByLocationPreference: 26,
  });
});

describe('POST /api/discovery/settings', () => {
  it('returns 401 when there is no authenticated session, and touches nothing', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(requestBodyFrom()));
    expect(response.status).toBe(401);
    expect(mocks.updateOwnScoringProfile).not.toHaveBeenCalled();
    expect(mocks.rankJobsForUser).not.toHaveBeenCalled();
  });

  it('returns 400 on a malformed payload, and touches nothing', async () => {
    const response = await POST(postRequest({ scoring: { preset: 'NOT_REAL' } }));
    expect(response.status).toBe(400);
    expect(mocks.updateOwnScoringProfile).not.toHaveBeenCalled();
    expect(mocks.updateOwnEligibilityProfile).not.toHaveBeenCalled();
    expect(mocks.rankJobsForUser).not.toHaveBeenCalled();
  });

  it('returns 400 on a request body that is not even valid JSON', async () => {
    const request = new Request('http://localhost/api/discovery/settings', {
      method: 'POST',
      body: 'not json{{{',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('a true no-op submission writes nothing and never triggers recompute', async () => {
    const response = await POST(postRequest(requestBodyFrom()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scoringChanged: false,
      eligibilityChanged: false,
      recompute: { attempted: false },
    });
    expect(mocks.updateOwnScoringProfile).not.toHaveBeenCalled();
    expect(mocks.updateOwnEligibilityProfile).not.toHaveBeenCalled();
    expect(mocks.rankJobsForUser).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('a scoring-only change saves only the scoring profile and still recomputes', async () => {
    const response = await POST(
      postRequest(requestBodyFrom({ criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 9 } })),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scoringChanged).toBe(true);
    expect(body.eligibilityChanged).toBe(false);
    expect(body.recompute).toEqual({
      attempted: true,
      succeeded: true,
      jobsConsidered: 1326,
      jobsScored: 1300,
      jobsExcludedByLocationPreference: 26,
    });
    expect(mocks.updateOwnScoringProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateOwnEligibilityProfile).not.toHaveBeenCalled();
    expect(mocks.rankJobsForUser).toHaveBeenCalledWith(ADMIN_CLIENT, USER_ID);
  });

  it('an eligibility-only change saves only the eligibility profile and still recomputes', async () => {
    const response = await POST(postRequest(requestBodyFrom({}, { isUsCitizen: true })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scoringChanged).toBe(false);
    expect(body.eligibilityChanged).toBe(true);
    expect(body.recompute.attempted).toBe(true);
    expect(mocks.updateOwnScoringProfile).not.toHaveBeenCalled();
    expect(mocks.updateOwnEligibilityProfile).toHaveBeenCalledTimes(1);
    expect(mocks.rankJobsForUser).toHaveBeenCalledTimes(1);
  });

  it('saves and recomputes when both profiles changed', async () => {
    const response = await POST(
      postRequest(
        requestBodyFrom(
          { criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 1 } },
          { isUsCitizen: true },
        ),
      ),
    );
    const body = await response.json();
    expect(body.scoringChanged).toBe(true);
    expect(body.eligibilityChanged).toBe(true);
    expect(mocks.updateOwnScoringProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateOwnEligibilityProfile).toHaveBeenCalledTimes(1);
    expect(mocks.rankJobsForUser).toHaveBeenCalledTimes(1);
  });

  it('derives userId only from the verified session, never from the request body', async () => {
    await POST(postRequest(requestBodyFrom({ criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 1 } })));
    expect(mocks.updateOwnScoringProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, expect.anything());
    expect(mocks.rankJobsForUser).toHaveBeenCalledWith(ADMIN_CLIENT, USER_ID);
  });

  it('a scoring profile persistence failure returns 500, never attempts recompute', async () => {
    mocks.updateOwnScoringProfile.mockRejectedValue(new Error('db down'));
    const response = await POST(
      postRequest(requestBodyFrom({ criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 1 } })),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.recompute).toEqual({ attempted: false });
    expect(mocks.rankJobsForUser).not.toHaveBeenCalled();
  });

  it('a recompute failure returns 502 but never claims success, and the profile save already happened', async () => {
    mocks.rankJobsForUser.mockRejectedValue(new Error('recompute exploded'));
    const response = await POST(
      postRequest(requestBodyFrom({ criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 1 } })),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.recompute).toEqual({ attempted: true, succeeded: false });
    expect(mocks.updateOwnScoringProfile).toHaveBeenCalledTimes(1);
    expect(typeof body.error).toBe('string');
  });

  it('uses the admin client only for the recompute step, never for reading/writing the profiles themselves', async () => {
    await POST(postRequest(requestBodyFrom({ criteriaWeights: { ...BASE_SCORING.criteriaWeights, ROLE_FIT: 1 } })));
    expect(mocks.getOrCreateOwnScoringProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID);
    expect(mocks.getOrCreateOwnEligibilityProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID);
    expect(mocks.updateOwnScoringProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, expect.anything());
  });
});
