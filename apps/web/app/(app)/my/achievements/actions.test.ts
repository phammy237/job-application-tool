import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createOwnAchievement: vi.fn(),
  createOwnEdge: vi.fn(),
  createOwnEvidence: vi.fn(),
  deleteOwnAchievement: vi.fn(),
  deleteOwnEvidence: vi.fn(),
  getOwnAchievement: vi.fn(),
  getOwnEvidence: vi.fn(),
  markAchievementVerifiedIfSupported: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnAchievement: mocks.createOwnAchievement,
  createOwnEdge: mocks.createOwnEdge,
  createOwnEvidence: mocks.createOwnEvidence,
  deleteOwnAchievement: mocks.deleteOwnAchievement,
  deleteOwnEvidence: mocks.deleteOwnEvidence,
  getOwnAchievement: mocks.getOwnAchievement,
  getOwnEvidence: mocks.getOwnEvidence,
  markAchievementVerifiedIfSupported: mocks.markAchievementVerifiedIfSupported,
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('./actions');

const USER = '22222222-2222-4222-8222-222222222222';
const ACH = '11111111-1111-4111-8111-111111111111';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const EVID = '44444444-4444-4444-8444-444444444444';
const CLIENT = { tag: 'session' };

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER });
  mocks.createClient.mockResolvedValue(CLIENT);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('achievement actions', () => {
  it('create deletes the achievement when the owner edge fails', async () => {
    mocks.createOwnAchievement.mockResolvedValue({ id: ACH });
    mocks.createOwnEdge.mockRejectedValue(new Error('boom'));
    const res = await actions.createAchievementAction(fd({ title: 'Won', projectId: PROJECT }));
    expect(res.ok).toBe(false);
    expect(mocks.deleteOwnAchievement).toHaveBeenCalledWith(CLIENT, USER, ACH);
  });

  it('links existing evidence with a USER_PROVIDED SUPPORTS edge', async () => {
    mocks.getOwnAchievement.mockResolvedValue({ id: ACH });
    mocks.getOwnEvidence.mockResolvedValue({ id: EVID });
    const res = await actions.linkAchievementEvidenceAction(fd({ id: ACH, evidenceId: EVID }));
    expect(res.ok).toBe(true);
    expect(mocks.createOwnEdge).toHaveBeenCalledWith(CLIENT, USER, {
      fromType: 'EVIDENCE',
      fromId: EVID,
      toType: 'ACHIEVEMENT',
      toId: ACH,
      relation: 'SUPPORTS',
      verificationState: 'USER_PROVIDED',
    });
  });

  it('refuses to link evidence or achievements the user does not own', async () => {
    mocks.getOwnAchievement.mockResolvedValue(null);
    mocks.getOwnEvidence.mockResolvedValue({ id: EVID });
    const res = await actions.linkAchievementEvidenceAction(fd({ id: ACH, evidenceId: EVID }));
    expect(res.ok).toBe(false);
    expect(mocks.createOwnEdge).not.toHaveBeenCalled();
  });

  it('new evidence is removed again if linking it fails', async () => {
    mocks.getOwnAchievement.mockResolvedValue({ id: ACH });
    mocks.createOwnEvidence.mockResolvedValue({ id: EVID });
    mocks.createOwnEdge.mockRejectedValue(new Error('boom'));
    const res = await actions.addAchievementEvidenceAction(
      fd({ id: ACH, title: 'Report', excerpt: 'numbers' }),
    );
    expect(res.ok).toBe(false);
    expect(mocks.deleteOwnEvidence).toHaveBeenCalledWith(CLIENT, USER, EVID);
  });

  it('mark verified fails honestly when no evidence supports the achievement', async () => {
    mocks.markAchievementVerifiedIfSupported.mockResolvedValue(null);
    const res = await actions.markAchievementVerifiedAction(fd({ id: ACH }));
    expect(res.ok).toBe(false);
    mocks.markAchievementVerifiedIfSupported.mockResolvedValue({ id: ACH });
    expect((await actions.markAchievementVerifiedAction(fd({ id: ACH }))).ok).toBe(true);
  });
});
