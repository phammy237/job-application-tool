import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  updateOwnAutoModeEnabled: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  updateOwnAutoModeEnabled: mocks.updateOwnAutoModeEnabled,
}));

vi.mock('../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auto-mode/toggle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
  mocks.createClient.mockResolvedValue({});
});

describe('POST /api/auto-mode/toggle', () => {
  it('returns 401 when there is no signed-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(jsonRequest({ enabled: true }));
    expect(response.status).toBe(401);
    expect(mocks.updateOwnAutoModeEnabled).not.toHaveBeenCalled();
  });

  it('returns 400 when "enabled" is missing or not a boolean', async () => {
    const response = await POST(jsonRequest({ enabled: 'yes' }));
    expect(response.status).toBe(400);
    expect(mocks.updateOwnAutoModeEnabled).not.toHaveBeenCalled();
  });

  it('enables Auto Mode with no prerequisite check, unlike background Gmail tracking', async () => {
    const response = await POST(jsonRequest({ enabled: true }));
    expect(response.status).toBe(200);
    expect(mocks.updateOwnAutoModeEnabled).toHaveBeenCalledWith(expect.anything(), USER_ID, true);
  });

  it('disables Auto Mode', async () => {
    const response = await POST(jsonRequest({ enabled: false }));
    expect(response.status).toBe(200);
    expect(mocks.updateOwnAutoModeEnabled).toHaveBeenCalledWith(expect.anything(), USER_ID, false);
  });
});
