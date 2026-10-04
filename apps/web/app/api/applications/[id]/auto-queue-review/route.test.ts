import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveOwnAutoQueuedApplication: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  resolveOwnAutoQueuedApplication: mocks.resolveOwnAutoQueuedApplication,
}));

vi.mock('../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

function jsonRequest(body: unknown): Request {
  return new Request(`http://localhost/api/applications/${APPLICATION_ID}/auto-queue-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: APPLICATION_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
  mocks.createClient.mockResolvedValue({});
});

describe('POST /api/applications/[id]/auto-queue-review', () => {
  it('returns 401 when there is no signed-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(jsonRequest({ action: 'KEEP' }), params());
    expect(response.status).toBe(401);
    expect(mocks.resolveOwnAutoQueuedApplication).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid action', async () => {
    const response = await POST(jsonRequest({ action: 'MAYBE' }), params());
    expect(response.status).toBe(400);
    expect(mocks.resolveOwnAutoQueuedApplication).not.toHaveBeenCalled();
  });

  it('resolves KEEP', async () => {
    mocks.resolveOwnAutoQueuedApplication.mockResolvedValue({
      id: APPLICATION_ID,
      autoQueueStatus: 'KEPT',
      status: 'SAVED',
    });

    const response = await POST(jsonRequest({ action: 'KEEP' }), params());
    expect(response.status).toBe(200);
    expect(mocks.resolveOwnAutoQueuedApplication).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
      'KEEP',
    );
  });

  it('resolves DISMISS', async () => {
    mocks.resolveOwnAutoQueuedApplication.mockResolvedValue({
      id: APPLICATION_ID,
      autoQueueStatus: 'DISMISSED',
      status: 'WITHDRAWN',
    });

    const response = await POST(jsonRequest({ action: 'DISMISS' }), params());
    expect(response.status).toBe(200);
    expect(mocks.resolveOwnAutoQueuedApplication).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
      'DISMISS',
    );
  });

  it('returns 404 (not 422) when the application is not found, not owned, or already resolved', async () => {
    mocks.resolveOwnAutoQueuedApplication.mockRejectedValue(
      new Error('Application not found or not owned by this user.'),
    );

    const response = await POST(jsonRequest({ action: 'KEEP' }), params());
    expect(response.status).toBe(404);
  });
});
