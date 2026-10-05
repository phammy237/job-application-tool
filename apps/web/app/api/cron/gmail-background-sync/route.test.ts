import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listUsersEligibleForBackgroundGmailSync: vi.fn(),
  runGmailSync: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listUsersEligibleForBackgroundGmailSync: mocks.listUsersEligibleForBackgroundGmailSync,
}));

vi.mock('@career-os/email', () => ({
  MAX_USERS_PER_BACKGROUND_SYNC_RUN: 20,
  MAX_CONCURRENT_BACKGROUND_SYNC_USERS: 5,
  runGmailSync: mocks.runGmailSync,
}));

vi.mock('../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET } = await import('./route');

const CRON_SECRET = 'test-cron-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/gmail-background-sync', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  mocks.createAdminClient.mockReturnValue({});
  mocks.listUsersEligibleForBackgroundGmailSync.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/gmail-background-sync', () => {
  it('returns 401 when CRON_SECRET is not configured on the project at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(cronRequest({ authorization: 'Bearer anything' }));
    expect(response.status).toBe(401);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(mocks.listUsersEligibleForBackgroundGmailSync).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header does not match CRON_SECRET — including a plausible-looking but wrong value', async () => {
    const response = await GET(cronRequest({ authorization: 'Bearer wrong-secret' }));
    expect(response.status).toBe(401);
    expect(mocks.listUsersEligibleForBackgroundGmailSync).not.toHaveBeenCalled();
  });

  it('runs sync for every eligible user when authorized', async () => {
    mocks.listUsersEligibleForBackgroundGmailSync.mockResolvedValue([USER_A, USER_B]);
    mocks.runGmailSync.mockResolvedValue({
      status: 'synced',
      processed: 3,
      autoApplied: 1,
      autoCreated: 1,
      needsConfirmation: 0,
      skipped: 1,
      errors: [],
    });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as { usersProcessed: number };

    expect(response.status).toBe(200);
    expect(body.usersProcessed).toBe(2);
    expect(mocks.runGmailSync).toHaveBeenCalledWith(expect.anything(), USER_A, expect.anything(), {
      allowAutoCreate: true,
    });
    expect(mocks.runGmailSync).toHaveBeenCalledWith(expect.anything(), USER_B, expect.anything(), {
      allowAutoCreate: true,
    });
  });

  it('runs at most MAX_CONCURRENT_BACKGROUND_SYNC_USERS syncs at once, not all eligible users at once', async () => {
    const userIds = Array.from({ length: 7 }, (_, i) => `${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000');
    mocks.listUsersEligibleForBackgroundGmailSync.mockResolvedValue(userIds);

    let inFlight = 0;
    let peakInFlight = 0;
    mocks.runGmailSync.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return {
        status: 'synced',
        processed: 0,
        autoApplied: 0,
        autoCreated: 0,
        needsConfirmation: 0,
        skipped: 0,
        errors: [],
      };
    });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as { usersProcessed: number };

    expect(response.status).toBe(200);
    expect(body.usersProcessed).toBe(7);
    expect(peakInFlight).toBeLessThanOrEqual(5);
    expect(peakInFlight).toBeGreaterThan(1); // proves it's not fully sequential either
  });

  it("continues processing remaining users when one user's sync throws", async () => {
    mocks.listUsersEligibleForBackgroundGmailSync.mockResolvedValue([USER_A, USER_B]);
    mocks.runGmailSync
      .mockRejectedValueOnce(new Error('token refresh failed'))
      .mockResolvedValueOnce({
        status: 'synced',
        processed: 1,
        autoApplied: 0,
        autoCreated: 0,
        needsConfirmation: 0,
        skipped: 1,
        errors: [],
      });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as {
      results: Array<{ userId: string; status: string; message?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { userId: USER_A, status: 'error', message: 'token refresh failed' },
      expect.objectContaining({ userId: USER_B, status: 'synced' }),
    ]);
  });

  it('reports no_connection without treating it as an error', async () => {
    mocks.listUsersEligibleForBackgroundGmailSync.mockResolvedValue([USER_A]);
    mocks.runGmailSync.mockResolvedValue({ status: 'no_connection' });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as { results: Array<{ status: string }> };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([{ userId: USER_A, status: 'no_connection' }]);
  });
});
