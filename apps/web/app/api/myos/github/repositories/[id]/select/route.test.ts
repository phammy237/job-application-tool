import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const REPO_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const EVIDENCE_ID = '55555555-5555-4555-8555-555555555555';

const updateChain = vi.hoisted(() => {
  const eq2 = vi.fn().mockResolvedValue({ error: null as unknown });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const update = vi.fn(() => ({ eq: eq1 }));
  return { update, eq1, eq2 };
});

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getOwnGithubConnection: vi.fn(),
  getOwnGithubRepository: vi.fn(),
  setOwnGithubRepositorySelected: vi.fn(),
  setOwnGithubRepositoryProject: vi.fn(),
  claimOwnGithubRepositoryProject: vi.fn(),
  createOwnProject: vi.fn(),
  deleteOwnProject: vi.fn(),
  updateOwnProjectDetail: vi.fn(),
  upsertOwnEvidenceBySource: vi.fn(),
  createOwnEdge: vi.fn(),
}));

vi.mock('../../../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('../../../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('../../../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@career-os/database', () => ({
  getOwnGithubConnection: mocks.getOwnGithubConnection,
  getOwnGithubRepository: mocks.getOwnGithubRepository,
  setOwnGithubRepositorySelected: mocks.setOwnGithubRepositorySelected,
  setOwnGithubRepositoryProject: mocks.setOwnGithubRepositoryProject,
  claimOwnGithubRepositoryProject: mocks.claimOwnGithubRepositoryProject,
  createOwnProject: mocks.createOwnProject,
  deleteOwnProject: mocks.deleteOwnProject,
  updateOwnProjectDetail: mocks.updateOwnProjectDetail,
  upsertOwnEvidenceBySource: mocks.upsertOwnEvidenceBySource,
  createOwnEdge: mocks.createOwnEdge,
}));

const { POST } = await import('./route');

const repo = {
  id: REPO_ID,
  fullName: 'octo/my-app',
  description: 'An app',
  htmlUrl: 'https://github.com/octo/my-app',
  isPrivate: true,
  topics: ['web'],
  languages: { TypeScript: 10 },
  stars: 1,
  repoCreatedAt: '2024-01-01T00:00:00.000Z',
  pushedAt: new Date().toISOString(),
  projectId: null,
};

const req = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id = REPO_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({ from: () => updateChain });
  mocks.createAdminClient.mockReturnValue({ tag: 'admin' });
  mocks.getOwnGithubConnection.mockResolvedValue({ hasToken: true });
  updateChain.eq2.mockResolvedValue({ error: null });
  mocks.getOwnGithubRepository.mockResolvedValue(repo);
  mocks.setOwnGithubRepositorySelected.mockResolvedValue({ ...repo, selected: true });
  mocks.setOwnGithubRepositoryProject.mockResolvedValue({ ...repo, selected: true });
  mocks.claimOwnGithubRepositoryProject.mockResolvedValue({
    ...repo,
    selected: true,
    projectId: PROJECT_ID,
  });
  mocks.createOwnProject.mockResolvedValue({ id: PROJECT_ID });
  mocks.upsertOwnEvidenceBySource.mockResolvedValue({ id: EVIDENCE_ID });
  mocks.createOwnEdge.mockResolvedValue({});
});

describe('POST /api/myos/github/repositories/[id]/select', () => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST(req({ selected: true }), ctx())).status).toBe(401);
  });

  it('rejects invalid ids and bodies', async () => {
    expect((await POST(req({ selected: true }), ctx('nope'))).status).toBe(400);
    expect((await POST(req({ selected: 'yes' }), ctx())).status).toBe(400);
  });

  it('returns 404 for a repository the user does not own', async () => {
    mocks.getOwnGithubRepository.mockResolvedValue(null);
    expect((await POST(req({ selected: true }), ctx())).status).toBe(404);
    expect(mocks.getOwnGithubRepository).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REPO_ID,
    );
    expect(mocks.setOwnGithubRepositorySelected).not.toHaveBeenCalled();
  });

  it('selecting creates an UNAPPROVED PRIVATE project, repo evidence, and a REPRESENTS edge', async () => {
    const res = await POST(req({ selected: true }), ctx());
    expect(res.status).toBe(200);
    const projectInput = mocks.createOwnProject.mock.calls[0]![2];
    expect(projectInput).toMatchObject({
      name: 'My App',
      userApproved: false,
      approvedForApplications: false,
      visibleOnPublicProfile: false,
    });
    expect(mocks.updateOwnProjectDetail).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      PROJECT_ID,
      { status: 'ACTIVE', visibility: 'PRIVATE' },
    );
    expect(updateChain.update).toHaveBeenCalledWith({ origin: 'GITHUB' });
    expect(mocks.claimOwnGithubRepositoryProject).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REPO_ID,
      PROJECT_ID,
    );
    // evidence creation uses the service-role client with the session user id
    expect(mocks.upsertOwnEvidenceBySource.mock.calls[0]![0]).toEqual({ tag: 'admin' });
    expect(mocks.upsertOwnEvidenceBySource.mock.calls[0]![1]).toBe(USER_ID);
    expect(mocks.upsertOwnEvidenceBySource.mock.calls[0]![2]).toMatchObject({
      sourceType: 'GITHUB_REPO',
      sourceRef: 'octo/my-app',
      visibility: 'PRIVATE',
      verificationState: 'VERIFIED',
    });
    expect(mocks.createOwnEdge).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        fromType: 'EVIDENCE',
        fromId: EVIDENCE_ID,
        toType: 'PROJECT',
        toId: PROJECT_ID,
        relation: 'REPRESENTS',
      }),
    );
  });

  it('writes USER_PROVIDED evidence when the connection has no validated token', async () => {
    mocks.getOwnGithubConnection.mockResolvedValue({ hasToken: false });
    await POST(req({ selected: true }), ctx());
    expect(mocks.upsertOwnEvidenceBySource.mock.calls[0]![2]).toMatchObject({
      verificationState: 'USER_PROVIDED',
    });
  });

  it('compensates (deletes the new project) and returns 500 when the origin update fails', async () => {
    updateChain.eq2.mockResolvedValue({ error: { message: 'boom' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req({ selected: true }), ctx());
    expect(res.status).toBe(500);
    expect(mocks.upsertOwnEvidenceBySource).not.toHaveBeenCalled();
    expect(mocks.deleteOwnProject).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      PROJECT_ID,
    );
    spy.mockRestore();
  });

  it('an already-linked repo gets no new project but its REPRESENTS edge is repaired', async () => {
    mocks.getOwnGithubRepository.mockResolvedValue({ ...repo, projectId: PROJECT_ID });
    const res = await POST(req({ selected: true }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.createOwnProject).not.toHaveBeenCalled();
    expect(mocks.claimOwnGithubRepositoryProject).not.toHaveBeenCalled();
    expect(mocks.createOwnEdge).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ toId: PROJECT_ID, relation: 'REPRESENTS' }),
    );
  });

  it('when the atomic claim is lost, deletes its project and returns the existing one', async () => {
    const OTHER = '66666666-6666-4666-8666-666666666666';
    mocks.claimOwnGithubRepositoryProject.mockResolvedValue(null);
    mocks.getOwnGithubRepository
      .mockResolvedValueOnce(repo)
      .mockResolvedValueOnce({ ...repo, projectId: OTHER });
    const res = await POST(req({ selected: true }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.deleteOwnProject).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      PROJECT_ID,
    );
    expect(mocks.createOwnEdge).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ toId: OTHER, relation: 'REPRESENTS' }),
    );
    expect((await res.json()).repository.projectId).toBe(OTHER);
  });

  it('compensates (releases the repo, deletes the project) and returns 500 when linking fails', async () => {
    mocks.createOwnEdge.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req({ selected: true }), ctx());
    expect(res.status).toBe(500);
    expect(mocks.setOwnGithubRepositoryProject).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REPO_ID,
      null,
    );
    expect(mocks.deleteOwnProject).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      PROJECT_ID,
    );
    spy.mockRestore();
  });

  it('does not create a project when unselecting', async () => {
    await POST(req({ selected: false }), ctx());
    expect(mocks.createOwnProject).not.toHaveBeenCalled();
    expect(mocks.setOwnGithubRepositorySelected).toHaveBeenCalledTimes(1);
  });
});
