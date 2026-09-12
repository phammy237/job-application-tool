import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateFollowUpDraft: vi.fn(),
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateFollowUpDraft: mocks.generateFollowUpDraft,
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
  return new Request(`http://localhost/api/applications/${APPLICATION_ID}/follow-up-draft`, {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

describe('POST /api/applications/[id]/follow-up-draft', () => {
  it('returns 401 without calling generateFollowUpDraft when there is no session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateFollowUpDraft).not.toHaveBeenCalled();
  });

  it('never accepts a client-supplied actionType or userId — the only input is the URL id', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({
      status: 'ok',
      draft: { subject: null, body: 'x', usedContext: [] },
    });
    await POST(postRequest(), PARAMS);
    expect(mocks.generateFollowUpDraft).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { applicationId: APPLICATION_ID },
    );
  });

  it('returns 404 when the application does not exist or is not owned by the caller', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({ status: 'application_not_found' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(404);
  });

  it('returns 200 with action_not_current when the deterministic action is no longer CONSIDER_FOLLOW_UP', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({
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

  it('returns 429 with usage details when rate-limited', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 50, aiRequestLimit: 50, aiRequestPeriodStartedAt: 'x' },
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(429);
  });

  it('returns 502 on a provider error', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({ status: 'provider_error', message: 'timeout' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 502 on validation_failed (rejected/invalid contract)', async () => {
    mocks.generateFollowUpDraft.mockResolvedValue({ status: 'validation_failed' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 200 with the draft on success', async () => {
    const draft = { subject: 'Hi', body: 'Following up.', usedContext: ['APPLICATION_STATUS'] };
    mocks.generateFollowUpDraft.mockResolvedValue({ status: 'ok', draft });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', draft });
  });
});
