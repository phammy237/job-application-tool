import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateInterviewPrep: vi.fn(),
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateInterviewPrep: mocks.generateInterviewPrep,
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
  return new Request(`http://localhost/api/applications/${APPLICATION_ID}/interview-prep`, {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

const EMPTY_PREP = {
  rolePriorities: [],
  evidenceToEmphasize: [],
  starStoryPrompts: [],
  possibleQuestions: [],
  questionsToAsk: [],
  gapsToPrepare: [],
  submittedAnswersToReview: [],
  provenanceSummary: 'Based on 0 job requirements and 0 approved profile facts.',
  usedCurrentRequirementMapping: false,
};

describe('POST /api/applications/[id]/interview-prep', () => {
  it('returns 401 without calling generateInterviewPrep when there is no session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateInterviewPrep).not.toHaveBeenCalled();
  });

  it('never accepts a client-supplied actionType — the only input is the URL id', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'ok', prep: EMPTY_PREP });
    await POST(postRequest(), PARAMS);
    expect(mocks.generateInterviewPrep).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { applicationId: APPLICATION_ID },
    );
  });

  it('returns 404 when the application does not exist or is not owned by the caller', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'application_not_found' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(404);
  });

  it('returns 200 with action_not_current when the deterministic action is no longer PREPARE_INTERVIEW', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
  });

  it('returns 200 with insufficient_context when there is no job snapshot', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'insufficient_context' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'insufficient_context' });
  });

  it('returns 429 when rate-limited', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 50, aiRequestLimit: 50, aiRequestPeriodStartedAt: 'x' },
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(429);
  });

  it('returns 502 on a provider error', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'provider_error', message: 'timeout' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 502 on validation_failed', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'validation_failed' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 200 with the prep result on success', async () => {
    mocks.generateInterviewPrep.mockResolvedValue({ status: 'ok', prep: EMPTY_PREP });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', prep: EMPTY_PREP });
  });
});
