import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
  getOwnApplication: vi.fn(),
  generateUnsupportedClaimsCheck: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
}));

vi.mock('@career-os/ai', () => ({
  generateUnsupportedClaimsCheck: mocks.generateUnsupportedClaimsCheck,
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
const ADMIN_CLIENT = { marker: 'admin' };

const UNSUPPORTED_FINDING = {
  id: 'f1',
  ruleId: 'UNSUPPORTED_CLAIM',
  severity: 'WARNING',
  fieldALabel: 'Describe a project you led',
  fieldASource: 'GENERATED_ANSWER',
  fieldAValue: 'I led the Kubernetes migration.',
  fieldBLabel: 'Approved evidence',
  fieldBSource: 'AI_EVIDENCE',
  fieldBValue: 'no supporting approved facts found',
  description: 'No approved fact backs this claim.',
};

function request() {
  return new Request('http://localhost', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue(ADMIN_CLIENT);
  mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID });
});

describe('POST /api/applications/[id]/unsupported-claims-check', () => {
  it('returns 401 when unauthenticated, without calling the pipeline', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.generateUnsupportedClaimsCheck).not.toHaveBeenCalled();
  });

  it('returns 404 when the application is not owned/found, without calling the pipeline', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(404);
    expect(mocks.generateUnsupportedClaimsCheck).not.toHaveBeenCalled();
  });

  it('derives userId from the session, never trusts a client-supplied id', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({ status: 'ok', findings: [] });
    await POST(request(), PARAMS);
    expect(mocks.getOwnApplication).toHaveBeenCalledWith(ADMIN_CLIENT, USER_ID, APPLICATION_ID);
    expect(mocks.generateUnsupportedClaimsCheck).toHaveBeenCalledWith(ADMIN_CLIENT, USER_ID, {
      applicationId: APPLICATION_ID,
    });
  });

  it('returns 200 with findings on a successful check', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({ status: 'ok', findings: [UNSUPPORTED_FINDING] });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', findings: [UNSUPPORTED_FINDING] });
  });

  it('returns 200 with an empty findings array when the check succeeds but finds nothing unsupported', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({ status: 'ok', findings: [] });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', findings: [] });
  });

  it.each([
    ['no_answers_to_check', 'no_claims_to_check'],
    ['insufficient_facts', 'no_claims_to_check'],
  ])('maps %s to 200 status=%s, never an error', async (pipelineStatus, expectedStatus) => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({ status: pipelineStatus });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(expectedStatus);
    expect(body.reason).toBe(pipelineStatus);
    expect(body.findings).toEqual([]);
  });

  it('maps rate_limited to 200 status=unavailable — never blocks or errors', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false },
    });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'unavailable', reason: 'rate_limited', findings: [] });
  });

  it('maps provider_error to 200 status=unavailable — never surfaces a fabricated finding', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({
      status: 'provider_error',
      message: 'network timeout',
    });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'unavailable', reason: 'provider_error', findings: [] });
  });

  it('maps validation_failed to 200 status=unavailable — a malformed model response is never surfaced as a finding', async () => {
    mocks.generateUnsupportedClaimsCheck.mockResolvedValue({ status: 'validation_failed' });
    const response = await POST(request(), PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'unavailable', reason: 'validation_failed', findings: [] });
  });
});
