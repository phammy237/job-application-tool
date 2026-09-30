import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserIdFromExtensionToken: vi.fn(),
  createAdminClient: vi.fn(),
  getOwnApplication: vi.fn(),
  evaluateOwnConsistencyFindings: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  evaluateOwnConsistencyFindings: mocks.evaluateOwnConsistencyFindings,
}));

vi.mock('../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../../lib/extension-auth', () => ({
  getUserIdFromExtensionToken: mocks.getUserIdFromExtensionToken,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET, OPTIONS } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const PARAMS = { params: Promise.resolve({ id: APPLICATION_ID }) };

const WARNING_FINDING = {
  id: 'w1',
  ruleId: 'GPA_MISMATCH',
  severity: 'WARNING',
  fieldALabel: 'A',
  fieldASource: 'GENERATED_ANSWER',
  fieldAValue: '3.2',
  fieldBLabel: 'B',
  fieldBSource: 'PROFILE_EDUCATION',
  fieldBValue: '3.9',
  description: 'Mismatch',
};
const BLOCKING_FINDING = {
  id: 'b1',
  ruleId: 'ELIGIBILITY_SELF_CONTRADICTION',
  severity: 'BLOCKING',
  fieldALabel: 'A',
  fieldASource: 'GENERATED_ANSWER',
  fieldAValue: 'Yes',
  fieldBLabel: 'B',
  fieldBSource: 'GENERATED_ANSWER',
  fieldBValue: 'No',
  description: 'Contradiction',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

describe('GET /api/applications/[id]/consistency-check', () => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.getOwnApplication).not.toHaveBeenCalled();
  });

  it('returns 404 when the application is not owned/found', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(404);
    expect(mocks.evaluateOwnConsistencyFindings).not.toHaveBeenCalled();
  });

  it('returns a clean result with zero counts when there are no findings', async () => {
    mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID });
    mocks.evaluateOwnConsistencyFindings.mockResolvedValue([]);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      findings: [],
      blockingCount: 0,
      warningCount: 0,
    });
  });

  it('reports accurate blocking/warning counts alongside the findings', async () => {
    mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID });
    mocks.evaluateOwnConsistencyFindings.mockResolvedValue([
      WARNING_FINDING,
      BLOCKING_FINDING,
    ]);
    const response = await GET(new Request('http://localhost'), PARAMS);
    const body = await response.json();
    expect(body.blockingCount).toBe(1);
    expect(body.warningCount).toBe(1);
    expect(body.findings).toHaveLength(2);
  });

  describe('extension bearer-token caller', () => {
    const extensionRequest = () =>
      new Request('http://localhost', {
        headers: { authorization: 'Bearer ext-token', origin: 'chrome-extension://abcdefg' },
      });

    it('authenticates via the extension token, not the cookie session', async () => {
      mocks.getUserIdFromExtensionToken.mockResolvedValue(USER_ID);
      mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID });
      mocks.evaluateOwnConsistencyFindings.mockResolvedValue([WARNING_FINDING]);
      const response = await GET(extensionRequest(), PARAMS);
      expect(response.status).toBe(200);
      expect(mocks.getCurrentUser).not.toHaveBeenCalled();
      expect(mocks.getOwnApplication).toHaveBeenCalledWith({}, USER_ID, APPLICATION_ID);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
    });

    it('returns 401 for an invalid token without falling back to the cookie session', async () => {
      mocks.getUserIdFromExtensionToken.mockResolvedValue(null);
      const response = await GET(extensionRequest(), PARAMS);
      expect(response.status).toBe(401);
      expect(mocks.getCurrentUser).not.toHaveBeenCalled();
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
    });

    it('answers the CORS preflight for a chrome-extension:// origin only', () => {
      const allowed = OPTIONS(
        new Request('http://localhost', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abcdefg' } }),
      );
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
      const other = OPTIONS(
        new Request('http://localhost', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } }),
      );
      expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });
});
