import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnGithubConnection: vi.fn(),
  deleteOwnGithubConnection: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('../../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@career-os/database', () => ({
  getOwnGithubConnection: mocks.getOwnGithubConnection,
  deleteOwnGithubConnection: mocks.deleteOwnGithubConnection,
}));

const { POST } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({ tag: 'c' });
  mocks.getOwnGithubConnection.mockResolvedValue({ githubLogin: 'octo' });
});

describe('POST /api/myos/github/disconnect', () => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(mocks.deleteOwnGithubConnection).not.toHaveBeenCalled();
  });

  it('returns 404 when there is no connection', async () => {
    mocks.getOwnGithubConnection.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);
  });

  it('deletes the signed-in user connection', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mocks.deleteOwnGithubConnection).toHaveBeenCalledWith({ tag: 'c' }, USER_ID);
  });
});
