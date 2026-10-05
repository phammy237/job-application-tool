import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listUsersEligibleForAutoQueue: vi.fn(),
  runAutoQueueForUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listUsersEligibleForAutoQueue: mocks.listUsersEligibleForAutoQueue,
}));

vi.mock('@career-os/discovery', () => ({
  MAX_USERS_PER_AUTO_QUEUE_RUN: 20,
  MAX_CONCURRENT_AUTO_QUEUE_USERS: 5,
  runAutoQueueForUser: mocks.runAutoQueueForUser,
}));

vi.mock('../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET } = await import('./route');

const CRON_SECRET = 'test-cron-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/auto-queue', { headers });
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

describe('GET /api/cron/auto-queue', () => {
  it('returns 401 when CRON_SECRET is not configured on the project at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(cronRequest({ authorization: 'Bearer anything' }));
    expect(response.status).toBe(401);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(mocks.listUsersEligibleForAutoQueue).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header does not match CRON_SECRET', async () => {
    const response = await GET(cronRequest({ authorization: 'Bearer wrong-secret' }));
    expect(response.status).toBe(401);
    expect(mocks.listUsersEligibleForAutoQueue).not.toHaveBeenCalled();
  });

  it('runs the orchestrator for every eligible user when authorized', async () => {
    mocks.listUsersEligibleForAutoQueue.mockResolvedValue([USER_A, USER_B]);
    mocks.runAutoQueueForUser.mockImplementation(async (_s, userId) => ({
      userId,
      candidatesConsidered: 3,
      alreadyTracked: 1,
      queued: 1,
      skippedAtBacklogCap: false,
    }));

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as { usersProcessed: number };

    expect(response.status).toBe(200);
    expect(body.usersProcessed).toBe(2);
    expect(mocks.runAutoQueueForUser).toHaveBeenCalledWith(expect.anything(), USER_A);
    expect(mocks.runAutoQueueForUser).toHaveBeenCalledWith(expect.anything(), USER_B);
  });

  it("continues processing remaining users when one user's run throws", async () => {
    mocks.listUsersEligibleForAutoQueue.mockResolvedValue([USER_A, USER_B]);
    mocks.runAutoQueueForUser
      .mockRejectedValueOnce(new Error('discovery query failed'))
      .mockResolvedValueOnce({
        userId: USER_B,
        candidatesConsidered: 0,
        alreadyTracked: 0,
        queued: 0,
        skippedAtBacklogCap: false,
      });

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = (await response.json()) as {
      results: Array<{ userId: string; status: string; message?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { userId: USER_A, status: 'error', message: 'discovery query failed' },
      expect.objectContaining({ userId: USER_B, status: 'queued' }),
    ]);
  });
});
