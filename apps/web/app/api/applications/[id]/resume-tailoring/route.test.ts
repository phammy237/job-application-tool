import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateResumeTailoringPlan: vi.fn(),
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateResumeTailoringPlan: mocks.generateResumeTailoringPlan,
}));

vi.mock('../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const PARAMS = { params: Promise.resolve({ id: APPLICATION_ID }) };

function postRequest(): Request {
  return new Request(`http://localhost/api/applications/${APPLICATION_ID}/resume-tailoring`, {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

const EMPTY_PROPOSAL = {
  baseResumeVersionId: '88888888-8888-4888-8888-888888888888',
  baseResumeDisplayName: 'v3',
  baseResumeVersionNumber: 3,
  customLatexOverridePresent: false,
  operations: [],
  summary: {
    rewrittenBullets: 0,
    addedBullets: 0,
    omittedBullets: 0,
    omittedEntries: 0,
    movedBullets: 0,
    movedEntries: 0,
    skillsReordered: false,
    requirementsReferenced: 0,
  },
  coverage: {
    totalRequirementCount: 0,
    coveredRequirementIds: [],
    unsupportedRequirementIds: [],
    referencedRequirementIds: [],
    unsupportedRequirements: [],
  },
  proposedResumeLatex: '\\documentclass{article}',
};

describe('POST /api/applications/[id]/resume-tailoring', () => {
  it('returns 401 without calling generateResumeTailoringPlan when there is no session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateResumeTailoringPlan).not.toHaveBeenCalled();
  });

  it('never accepts a client-supplied resumeVersionId or any other body field — the only input is the URL id', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'ok', proposal: EMPTY_PROPOSAL });
    await POST(postRequest(), PARAMS);
    expect(mocks.generateResumeTailoringPlan).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { applicationId: APPLICATION_ID },
    );
  });

  it('returns 404 when the application does not exist or is not owned by the caller', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'application_not_found' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(404);
  });

  it('returns 200 with no_working_resume when the application has no working résumé selected', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'no_working_resume' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'no_working_resume' });
  });

  it('returns 200 with unsupported_resume_format for a METADATA_ONLY working résumé', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'unsupported_resume_format' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unsupported_resume_format' });
  });

  it('returns 200 with missing_job_snapshot when there is no job snapshot', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'missing_job_snapshot' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'missing_job_snapshot' });
  });

  it('returns 429 when rate-limited', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 50, aiRequestLimit: 50, aiRequestPeriodStartedAt: 'x' },
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(429);
  });

  it('returns 502 on a provider error', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'provider_error', message: 'timeout' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 502 on validation_failed', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'validation_failed' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 200 with the proposal on success', async () => {
    mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'ok', proposal: EMPTY_PROPOSAL });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', proposal: EMPTY_PROPOSAL });
  });
});
