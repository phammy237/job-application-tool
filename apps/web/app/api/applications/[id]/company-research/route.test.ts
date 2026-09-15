import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateCompanyResearch: vi.fn(),
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateCompanyResearch: mocks.generateCompanyResearch,
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
  return new Request(
    `http://localhost/api/applications/${APPLICATION_ID}/company-research`,
    {
      method: 'POST',
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

const SNAPSHOT = {
  id: 's1',
  userId: USER_ID,
  applicationId: APPLICATION_ID,
  companyName: 'Acme',
  roleTitle: 'Engineer',
  jobSnapshotId: null,
  researchedAt: '2026-09-15T00:00:00.000Z',
  createdAt: '2026-09-15T00:00:00.000Z',
  findings: [],
  sources: [],
};

describe('POST /api/applications/[id]/company-research', () => {
  it('returns 401 without calling generateCompanyResearch when there is no session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateCompanyResearch).not.toHaveBeenCalled();
  });

  it('never accepts a client-supplied company/role or any other body field — the only input is the URL id', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({ status: 'ok', snapshot: SNAPSHOT });
    await POST(postRequest(), PARAMS);
    expect(mocks.generateCompanyResearch).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { applicationId: APPLICATION_ID },
    );
  });

  it('returns 404 when the application does not exist or is not owned by the caller', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({ status: 'application_not_found' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(404);
  });

  it('returns 429 when rate-limited', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'rate_limited',
      usage: {
        allowed: false,
        aiRequestsThisPeriod: 50,
        aiRequestLimit: 50,
        aiRequestPeriodStartedAt: 'x',
      },
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(429);
  });

  it('returns 200 with research_provider_unavailable', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'research_provider_unavailable',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'research_provider_unavailable' });
  });

  it('returns 200 with no_useful_sources', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({ status: 'no_useful_sources' });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'no_useful_sources' });
  });

  it('returns 200 with insufficient_source_evidence', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'insufficient_source_evidence',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
  });

  it('returns 200 with stale_application_context — never a 5xx for an honest staleness refusal', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'stale_application_context',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'stale_application_context' });
  });

  it('returns 502 on a search-provider error', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'search_provider_error',
      message: 'timeout',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 502 when the AI provider is unavailable', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'ai_provider_unavailable',
      message: 'down',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 502 on invalid_research_output', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({
      status: 'invalid_research_output',
    });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 200 with the snapshot on success', async () => {
    mocks.generateCompanyResearch.mockResolvedValue({ status: 'ok', snapshot: SNAPSHOT });
    const response = await POST(postRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', snapshot: SNAPSHOT });
  });
});
