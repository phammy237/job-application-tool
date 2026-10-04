import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listUsersEligibleForAutoQueue: vi.fn(),
  runAutoTailorDraftsForUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listUsersEligibleForAutoQueue: mocks.listUsersEligibleForAutoQueue,
}));

vi.mock('@career-os/ai', () => ({
  MAX_USERS_PER_AUTO_TAILOR_RUN: 20,
  MAX_CONCURRENT_AUTO_TAILOR_USERS: 5,
  runAutoTailorDraftsForUser: mocks.runAutoTailorDraftsForUser,
}));

vi.mock('../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET } = await import('./route');

const CRON_SECRET = 'test-cron-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/auto-tailor-drafts', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  mocks.createAdminClient.mockReturnValue({});
  mocks.listUsersEligibleForAutoQueue.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/auto-tailor-drafts', () => {
  it('returns 401 when CRON_SECRET is not configured on the project at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(cronRequest({ authorization: 'Bearer anything' }));
    expect(response.status).toBe(401);
  });

  it('returns 401 when the Authorization header does not match CRON_SECRET', async () => {
    const response = await GET(cronRequest({ authorization: 'Bearer wrong-secret' }));
    expect(response.status).toBe(401);
    expect(mocks.listUsersEligibleForAutoQueue).not.toHaveBeenCalled();
  });

  it('runs the auto-tailoring orchestrator for every eligible (Auto Mode-enabled) user', async () => {
    mocks.listUsersEligibleForAutoQueue.mockResolvedValue([USER_A, USER_B]);
    mocks.runAutoTailorDraftsForUser.mockImplementation(async (_s, userId) => ({
      userId,
      eligible: 2,
      drafted: 1,
      skippedExisting: 0,
      rateLimited: false,
    }));

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as { usersProcessed: number };

    expect(response.status).toBe(200);
    expect(body.usersProcessed).toBe(2);
    expect(mocks.runAutoTailorDraftsForUser).toHaveBeenCalledWith(expect.anything(), USER_A);
    expect(mocks.runAutoTailorDraftsForUser).toHaveBeenCalledWith(expect.anything(), USER_B);
  });

  it("continues processing remaining users when one user's run throws", async () => {
    mocks.listUsersEligibleForAutoQueue.mockResolvedValue([USER_A, USER_B]);
    mocks.runAutoTailorDraftsForUser
      .mockRejectedValueOnce(new Error('claude call failed'))
      .mockResolvedValueOnce({
        userId: USER_B,
        eligible: 0,
        drafted: 0,
        skippedExisting: 0,
        rateLimited: false,
      });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as {
      results: Array<{ userId: string; status: string; message?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { userId: USER_A, status: 'error', message: 'claude call failed' },
      expect.objectContaining({ userId: USER_B, status: 'drafted' }),
    ]);
  });
});
