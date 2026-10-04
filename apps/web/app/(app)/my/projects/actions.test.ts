import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getOwnProjectDetail: vi.fn(),
  listOwnEdgesForNode: vi.fn(),
  deleteOwnEdge: vi.fn(),
  getOwnCandidate: vi.fn(),
  acceptOwnCandidate: vi.fn(),
  rejectOwnCandidate: vi.fn(),
  updateOwnProject: vi.fn(),
  deleteOwnProject: vi.fn(),
  createOwnProject: vi.fn(),
  updateOwnProjectDetail: vi.fn(),
  createOwnEvidence: vi.fn(),
  createOwnEdge: vi.fn(),
  deleteOwnEvidence: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  acceptOwnCandidate: mocks.acceptOwnCandidate,
  rejectOwnCandidate: mocks.rejectOwnCandidate,
  createOwnAchievement: vi.fn(),
  createOwnEdge: mocks.createOwnEdge,
  createOwnEvidence: mocks.createOwnEvidence,
  createOwnProject: mocks.createOwnProject,
  deleteOwnEvidence: mocks.deleteOwnEvidence,
  createOwnSkill: vi.fn(),
  deleteOwnAchievement: vi.fn(),
  deleteOwnEdge: mocks.deleteOwnEdge,
  deleteOwnProject: mocks.deleteOwnProject,
  getOwnAchievement: vi.fn(),
  getOwnCandidate: mocks.getOwnCandidate,
  getOwnProjectDetail: mocks.getOwnProjectDetail,
  listOwnEdgesForNode: mocks.listOwnEdgesForNode,
  listOwnSkills: vi.fn(),
  updateOwnProject: mocks.updateOwnProject,
  updateOwnProjectDetail: mocks.updateOwnProjectDetail,
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const actions = await import('./actions');

const USER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const EDGE = '33333333-3333-4333-8333-333333333333';
const CAND = '44444444-4444-4444-8444-444444444444';
const CLIENT = { tag: 'session' };

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

async function redirected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith('REDIRECT:')) return decodeURIComponent(m.slice('REDIRECT:'.length));
    throw e;
  }
  throw new Error('expected redirect');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER });
  mocks.createClient.mockResolvedValue(CLIENT);
  mocks.getOwnProjectDetail.mockResolvedValue({ projectId: PROJECT });
});

describe('project actions', () => {
  it('rejects an unowned project before writing anything', async () => {
    mocks.getOwnProjectDetail.mockResolvedValue(null);
    const url = await redirected(
      actions.setProjectApprovalAction(fd({ id: PROJECT, userApproved: 'on' })),
    );
    expect(url).toContain('error=not_found');
    expect(mocks.updateOwnProject).not.toHaveBeenCalled();
  });

  it('derives the user from the session and ignores a client user id', async () => {
    const url = await redirected(
      actions.setProjectApprovalAction(fd({ id: PROJECT, userApproved: 'on', userId: 'evil' })),
    );
    expect(url).toContain('notice=');
    expect(mocks.getOwnProjectDetail).toHaveBeenCalledWith(CLIENT, USER, PROJECT);
    expect(mocks.updateOwnProject).toHaveBeenCalledWith(CLIENT, USER, PROJECT, {
      userApproved: true,
      approvedForApplications: false,
    });
  });

  it('refuses to delete an edge that is not attached to the project', async () => {
    mocks.listOwnEdgesForNode.mockResolvedValue([]);
    const url = await redirected(actions.removeProjectSkillAction(fd({ id: PROJECT, edgeId: EDGE })));
    expect(url).toContain('error=');
    expect(mocks.deleteOwnEdge).not.toHaveBeenCalled();
  });

  it('deletes an attached edge', async () => {
    mocks.listOwnEdgesForNode.mockResolvedValue([{ id: EDGE }]);
    await redirected(actions.removeProjectSkillAction(fd({ id: PROJECT, edgeId: EDGE })));
    expect(mocks.deleteOwnEdge).toHaveBeenCalledWith(CLIENT, USER, EDGE);
  });

  it('only accepts a pending candidate that belongs to this project', async () => {
    mocks.getOwnCandidate.mockResolvedValue({ id: CAND, projectId: 'other', status: 'PENDING' });
    const bad = await redirected(actions.acceptCandidateAction(fd({ id: PROJECT, candidateId: CAND })));
    expect(bad).toContain('error=');
    expect(mocks.acceptOwnCandidate).not.toHaveBeenCalled();

    mocks.getOwnCandidate.mockResolvedValue({ id: CAND, projectId: PROJECT, status: 'PENDING' });
    await redirected(actions.acceptCandidateAction(fd({ id: PROJECT, candidateId: CAND })));
    expect(mocks.acceptOwnCandidate).toHaveBeenCalledWith(CLIENT, USER, CAND);
  });

  it('reports validation errors without writing', async () => {
    const url = await redirected(actions.setProjectVisibilityAction(fd({ id: PROJECT, visibility: 'WORLD' })));
    expect(url).toContain('error=');
  });

  it('deletes only owned projects', async () => {
    await redirected(actions.deleteProjectAction(fd({ id: PROJECT })));
    expect(mocks.deleteOwnProject).toHaveBeenCalledWith(CLIENT, USER, PROJECT);

    mocks.deleteOwnProject.mockClear();
    mocks.getOwnProjectDetail.mockResolvedValue(null);
    await redirected(actions.deleteProjectAction(fd({ id: PROJECT })));
    expect(mocks.deleteOwnProject).not.toHaveBeenCalled();
  });

  it('uses fixed notice codes, never free text', async () => {
    const url = await redirected(
      actions.setProjectVisibilityAction(fd({ id: PROJECT, visibility: 'PUBLIC' })),
    );
    expect(url).toContain('notice=visibility_saved');
  });

  it('createProject deletes the just-created project when the detail update fails', async () => {
    mocks.createOwnProject.mockResolvedValue({ id: PROJECT });
    mocks.updateOwnProjectDetail.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await redirected(actions.createProjectAction(fd({ name: 'X' })));
    expect(url).toContain('error=create_failed');
    expect(mocks.deleteOwnProject).toHaveBeenCalledWith(CLIENT, USER, PROJECT);
    spy.mockRestore();
  });

  it('addProjectEvidence deletes the evidence row when linking it fails', async () => {
    mocks.createOwnEvidence.mockResolvedValue({ id: CAND });
    mocks.createOwnEdge.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await redirected(
      actions.addProjectEvidenceAction(fd({ id: PROJECT, title: 'T', excerpt: 'note' })),
    );
    expect(url).toContain('error=failed');
    expect(mocks.deleteOwnEvidence).toHaveBeenCalledWith(CLIENT, USER, CAND);
    spy.mockRestore();
  });

  it('deleteProjectEvidence only deletes evidence linked to the project', async () => {
    mocks.listOwnEdgesForNode.mockResolvedValue([]);
    const bad = await redirected(
      actions.deleteProjectEvidenceAction(fd({ id: PROJECT, evidenceId: CAND })),
    );
    expect(bad).toContain('error=evidence_mismatch');
    expect(mocks.deleteOwnEvidence).not.toHaveBeenCalled();

    mocks.listOwnEdgesForNode.mockResolvedValue([{ id: EDGE, fromType: 'EVIDENCE', fromId: CAND }]);
    await redirected(actions.deleteProjectEvidenceAction(fd({ id: PROJECT, evidenceId: CAND })));
    expect(mocks.deleteOwnEvidence).toHaveBeenCalledWith(CLIENT, USER, CAND);
  });
});
