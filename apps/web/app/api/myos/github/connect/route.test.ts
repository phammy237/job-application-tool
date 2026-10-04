import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'ghp_SECRETTOKENVALUE1234567890abcd';
const USER_ID = '22222222-2222-4222-8222-222222222222';

class MockAuthError extends Error {}
class MockRateLimitError extends Error {}

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnGithubConnection: vi.fn(),
  deleteOwnGithubConnection: vi.fn(),
  upsertOwnGithubConnection: vi.fn(),
  saveGithubAccessToken: vi.fn(),
  getAuthenticatedUser: vi.fn(),
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
vi.mock('@career-os/database', () => ({
  getOwnGithubConnection: mocks.getOwnGithubConnection,
  deleteOwnGithubConnection: mocks.deleteOwnGithubConnection,
  upsertOwnGithubConnection: mocks.upsertOwnGithubConnection,
  saveGithubAccessToken: mocks.saveGithubAccessToken,
}));
vi.mock('@career-os/myos', () => ({
  AuthError: MockAuthError,
  RateLimitError: MockRateLimitError,
  GithubClient: class {
    getAuthenticatedUser = mocks.getAuthenticatedUser;
  },
}));

const { POST } = await import('./route');

const post = (body: unknown) =>
  new Request('http://localhost/api/myos/github/connect', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({ tag: 'user-client' });
  mocks.createAdminClient.mockReturnValue({ tag: 'admin-client' });
  mocks.getOwnGithubConnection.mockResolvedValue(null);
  mocks.upsertOwnGithubConnection.mockImplementation(async (_s, userId, input) => ({
    userId,
    githubLogin: input.login,
    hasToken: input.hasToken,
  }));
});

describe('POST /api/myos/github/connect', () => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await POST(post({ login: 'octo' }));
    expect(res.status).toBe(401);
    expect(mocks.upsertOwnGithubConnection).not.toHaveBeenCalled();
  });

  it('rejects invalid logins, malformed JSON, and oversized bodies', async () => {
    expect((await POST(post({ login: '-bad-' }))).status).toBe(400);
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ login: 'octo', pad: 'x'.repeat(5000) }))).status).toBe(413);
  });

  it('connects username-only without calling GitHub or storing a token', async () => {
    const res = await POST(post({ login: 'octo' }));
    expect(res.status).toBe(200);
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.saveGithubAccessToken).not.toHaveBeenCalled();
    expect(mocks.upsertOwnGithubConnection).toHaveBeenCalledWith(
      { tag: 'user-client' },
      USER_ID,
      expect.objectContaining({ login: 'octo', hasToken: false }),
    );
  });

  it('validates the token, stores it with the admin client, and never echoes it', async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ login: 'Octo', id: 99 });
    const res = await POST(post({ login: 'octo', token: TOKEN }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
    expect(mocks.saveGithubAccessToken).toHaveBeenCalledWith(
      { tag: 'admin-client' },
      USER_ID,
      TOKEN,
    );
    expect(mocks.upsertOwnGithubConnection).toHaveBeenCalledWith(
      { tag: 'user-client' },
      USER_ID,
      expect.objectContaining({ hasToken: true, githubUserId: 99 }),
    );
  });

  it('derives user_id from the session, ignoring any body-supplied user id', async () => {
    await POST(post({ login: 'octo', userId: 'attacker', user_id: 'attacker' }));
    expect(mocks.upsertOwnGithubConnection.mock.calls[0]![1]).toBe(USER_ID);
  });

  it('rejects a token that belongs to a different login', async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ login: 'someone-else', id: 5 });
    const res = await POST(post({ login: 'octo', token: TOKEN }));
    expect(res.status).toBe(400);
    expect(mocks.saveGithubAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });

  it('returns 400 when GitHub rejects the token, without leaking it', async () => {
    mocks.getAuthenticatedUser.mockRejectedValue(new MockAuthError(`bad ${TOKEN}`));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(post({ login: 'octo', token: TOKEN }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });

  it('drops the old connection when reconnecting as a different login', async () => {
    mocks.getOwnGithubConnection.mockResolvedValue({
      githubLogin: 'old',
      hasToken: true,
    });
    await POST(post({ login: 'octo' }));
    expect(mocks.deleteOwnGithubConnection).toHaveBeenCalledWith(
      { tag: 'user-client' },
      USER_ID,
    );
    expect(mocks.upsertOwnGithubConnection).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ hasToken: false }),
    );
  });
});
