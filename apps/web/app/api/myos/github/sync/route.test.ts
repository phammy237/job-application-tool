import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnGithubConnection: vi.fn(),
  listOwnGithubSyncRuns: vi.fn(),
  getGithubAccessToken: vi.fn(),
  syncGithubRepositories: vi.fn(),
  clientOptions: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('../../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('../../../../../lib/myos-github-store', () => ({
  createGithubSyncStore: () => ({ tag: 'store' }),
}));
vi.mock('@career-os/database', () => ({
  getOwnGithubConnection: mocks.getOwnGithubConnection,
  listOwnGithubSyncRuns: mocks.listOwnGithubSyncRuns,
  getGithubAccessToken: mocks.getGithubAccessToken,
}));
vi.mock('@career-os/myos', () => ({
  GithubClient: class {
    constructor(opts: unknown) {
      mocks.clientOptions(opts);
    }
  },
  syncGithubRepositories: mocks.syncGithubRepositories,
}));

const { POST } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({});
  mocks.createAdminClient.mockReturnValue({});
  mocks.getOwnGithubConnection.mockResolvedValue({ githubLogin: 'octo', hasToken: true });
  mocks.listOwnGithubSyncRuns.mockResolvedValue([]);
  mocks.getGithubAccessToken.mockResolvedValue('ghp_tok');
  mocks.syncGithubRepositories.mockResolvedValue({
    runId: 'run-1',
    status: 'SUCCEEDED',
    stats: { detailSynced: 1 },
    error: null,
  });
});

describe('POST /api/myos/github/sync', () => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(mocks.syncGithubRepositories).not.toHaveBeenCalled();
  });

  it('returns 404 without a connection', async () => {
    mocks.getOwnGithubConnection.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);
  });

  it('returns 409 when a RUNNING run started under 10 minutes ago exists', async () => {
    mocks.listOwnGithubSyncRuns.mockResolvedValue([
      { status: 'RUNNING', startedAt: new Date(Date.now() - 60_000).toISOString() },
    ]);
    expect((await POST()).status).toBe(409);
    expect(mocks.syncGithubRepositories).not.toHaveBeenCalled();
  });

  it('ignores a stale RUNNING run older than 10 minutes', async () => {
    mocks.listOwnGithubSyncRuns.mockResolvedValue([
      { status: 'RUNNING', startedAt: new Date(Date.now() - 11 * 60_000).toISOString() },
    ]);
    expect((await POST()).status).toBe(200);
  });

  it('runs the sync for the session user with the stored token and returns stats only', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runId: 'run-1',
      status: 'SUCCEEDED',
      stats: { detailSynced: 1 },
      error: null,
    });
    expect(mocks.syncGithubRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, login: 'octo' }),
    );
    expect(mocks.clientOptions).toHaveBeenCalledWith({ token: 'ghp_tok' });
  });

  it('uses no token for username-only connections', async () => {
    mocks.getOwnGithubConnection.mockResolvedValue({
      githubLogin: 'octo',
      hasToken: false,
    });
    await POST();
    expect(mocks.getGithubAccessToken).not.toHaveBeenCalled();
    expect(mocks.clientOptions).toHaveBeenCalledWith({ token: null });
  });

  it('returns 409 asking to reconnect when the stored token cannot be decrypted', async () => {
    mocks.getGithubAccessToken.mockRejectedValue(new Error('tamper'));
    expect((await POST()).status).toBe(409);
  });

  it('returns 502 with a generic message if the sync throws', async () => {
    mocks.syncGithubRepositories.mockRejectedValue(new Error('db down ghp_leak'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('ghp_leak');
    spy.mockRestore();
  });
});
