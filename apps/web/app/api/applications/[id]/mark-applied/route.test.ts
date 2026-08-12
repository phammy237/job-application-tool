import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  markOwnApplicationApplied: vi.fn(),
  getUserIdFromExtensionToken: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  markOwnApplicationApplied: mocks.markOwnApplicationApplied,
}));

vi.mock('../../../../../lib/extension-auth', () => ({
  getUserIdFromExtensionToken: mocks.getUserIdFromExtensionToken,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { PATCH, OPTIONS } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const PARAMS = { params: Promise.resolve({ id: APPLICATION_ID }) };

function patchRequest(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/applications/${APPLICATION_ID}/mark-applied`, {
    method: 'PATCH',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserIdFromExtensionToken.mockResolvedValue(USER_ID);
  mocks.createAdminClient.mockReturnValue({});
});

describe('PATCH /api/applications/[id]/mark-applied', () => {
  it('returns 401 when there is no valid extension bearer token', async () => {
    mocks.getUserIdFromExtensionToken.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.markOwnApplicationApplied).not.toHaveBeenCalled();
  });

  it('marks the application applied and returns the updated status', async () => {
    mocks.markOwnApplicationApplied.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    const response = await PATCH(patchRequest(), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applicationId: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mocks.markOwnApplicationApplied).toHaveBeenCalledWith(expect.anything(), USER_ID, APPLICATION_ID);
  });

  it('returns 404 without leaking whether the application exists under another account', async () => {
    mocks.markOwnApplicationApplied.mockRejectedValue(new Error('not found or not owned'));
    const response = await PATCH(patchRequest(), PARAMS);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).not.toMatch(/owned|another/i);
  });

  it('reflects a chrome-extension:// origin in Access-Control-Allow-Origin', async () => {
    mocks.markOwnApplicationApplied.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    const response = await PATCH(patchRequest({ origin: 'chrome-extension://abcdefg' }), PARAMS);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
  });

  it('OPTIONS returns 204 with CORS headers for a preflight from the extension', () => {
    const request = new Request(`http://localhost/api/applications/${APPLICATION_ID}/mark-applied`, {
      method: 'OPTIONS',
      headers: { origin: 'chrome-extension://abcdefg' },
    });
    const response = OPTIONS(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
  });
});
