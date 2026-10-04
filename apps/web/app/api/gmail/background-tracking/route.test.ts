import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isGmailSyncEnabledForUser: vi.fn(),
  updateOwnBackgroundGmailTrackingEnabled: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  updateOwnBackgroundGmailTrackingEnabled: mocks.updateOwnBackgroundGmailTrackingEnabled,
}));

vi.mock('../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../lib/gmail-feature-gate', () => ({
  isGmailSyncEnabledForUser: mocks.isGmailSyncEnabledForUser,
}));

vi.mock('../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/gmail/background-tracking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
  mocks.createClient.mockResolvedValue({});
  mocks.isGmailSyncEnabledForUser.mockResolvedValue(true);
});

describe('POST /api/gmail/background-tracking', () => {
  it('returns 401 when there is no signed-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(jsonRequest({ enabled: true }));
    expect(response.status).toBe(401);
    expect(mocks.updateOwnBackgroundGmailTrackingEnabled).not.toHaveBeenCalled();
  });

  it('returns 400 when "enabled" is missing or not a boolean', async () => {
    const response = await POST(jsonRequest({ enabled: 'yes' }));
    expect(response.status).toBe(400);
    expect(mocks.updateOwnBackgroundGmailTrackingEnabled).not.toHaveBeenCalled();
  });

  it('refuses to enable when the user has not connected Gmail for manual sync', async () => {
    mocks.isGmailSyncEnabledForUser.mockResolvedValue(false);
    const response = await POST(jsonRequest({ enabled: true }));
    expect(response.status).toBe(403);
    expect(mocks.updateOwnBackgroundGmailTrackingEnabled).not.toHaveBeenCalled();
  });

  it('enables background tracking when Gmail sync is already enabled', async () => {
    const response = await POST(jsonRequest({ enabled: true }));
    expect(response.status).toBe(200);
    expect(mocks.updateOwnBackgroundGmailTrackingEnabled).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      true,
    );
  });

  it('allows disabling even when the base Gmail sync check would fail', async () => {
    mocks.isGmailSyncEnabledForUser.mockResolvedValue(false);
    const response = await POST(jsonRequest({ enabled: false }));
    expect(response.status).toBe(200);
    expect(mocks.updateOwnBackgroundGmailTrackingEnabled).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      false,
    );
  });
});
