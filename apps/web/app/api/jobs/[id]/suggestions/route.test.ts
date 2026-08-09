import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateSuggestion: vi.fn(),
  getUserIdFromExtensionToken: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateSuggestion: mocks.generateSuggestion,
}));

vi.mock('../../../../../lib/extension-auth', () => ({
  getUserIdFromExtensionToken: mocks.getUserIdFromExtensionToken,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const PARAMS = { params: Promise.resolve({ id: 'job-1' }) };

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/jobs/job-1/suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { fieldLabel: 'Describe a project.', fieldClassification: 'EXPERIENCE' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserIdFromExtensionToken.mockResolvedValue(USER_ID);
  mocks.createAdminClient.mockReturnValue({});
});

describe('POST /api/jobs/[id]/suggestions', () => {
  it('returns 401 when there is no valid extension bearer token', async () => {
    mocks.getUserIdFromExtensionToken.mockResolvedValue(null);
    const response = await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateSuggestion).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed request body', async () => {
    const response = await POST(jsonRequest({ fieldLabel: '' }), PARAMS);
    expect(response.status).toBe(400);
    expect(mocks.generateSuggestion).not.toHaveBeenCalled();
  });

  it('returns 404 when generateSuggestion reports the job was not found', async () => {
    mocks.generateSuggestion.mockResolvedValue({ status: 'job_not_found' });
    const response = await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(404);
  });

  it('returns 429 with usage details when the AI request limit is reached', async () => {
    const usage = {
      allowed: false,
      aiRequestsThisPeriod: 50,
      aiRequestLimit: 50,
      aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
    };
    mocks.generateSuggestion.mockResolvedValue({ status: 'rate_limited', usage });
    const response = await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.usage).toEqual(usage);
  });

  it('returns 502 on a provider error', async () => {
    mocks.generateSuggestion.mockResolvedValue({
      status: 'provider_error',
      message: 'network timeout',
    });
    const response = await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(502);
  });

  it('returns 200 with the suggestion on success', async () => {
    const answer = { id: 'generated-1', answer: 'Built the payments service.' };
    mocks.generateSuggestion.mockResolvedValue({ status: 'generated', answer });
    const response = await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'generated', suggestion: answer });
  });

  it('returns 200 for honest non-error outcomes (not_supported_for_field, insufficient_facts, no_suggestion)', async () => {
    for (const status of ['not_supported_for_field', 'insufficient_facts', 'no_suggestion']) {
      mocks.generateSuggestion.mockResolvedValue({ status });
      const response = await POST(jsonRequest(VALID_BODY), PARAMS);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status });
    }
  });

  it('passes the verified userId and job id from the URL through to generateSuggestion, never a client-supplied id', async () => {
    mocks.generateSuggestion.mockResolvedValue({ status: 'insufficient_facts' });
    await POST(jsonRequest(VALID_BODY), PARAMS);
    expect(mocks.generateSuggestion).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });
});
