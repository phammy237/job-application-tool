import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createOwnSkill: vi.fn(),
  listOwnSkills: vi.fn(),
  deleteOwnSkill: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnEdge: vi.fn(),
  createOwnSkill: mocks.createOwnSkill,
  listOwnSkills: mocks.listOwnSkills,
  deleteOwnSkill: mocks.deleteOwnSkill,
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('./actions');

const USER = '22222222-2222-4222-8222-222222222222';
const SKILL = '11111111-1111-4111-8111-111111111111';

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER });
  mocks.createClient.mockResolvedValue({ tag: 'session' });
});

describe('skill actions', () => {
  it('a unique-violation from a duplicate submit re-selects the existing skill and succeeds', async () => {
    mocks.listOwnSkills
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SKILL, name: 'TypeScript' }]);
    mocks.createOwnSkill.mockRejectedValue(
      new Error('createOwnSkill: duplicate key value violates unique constraint (23505)'),
    );
    const res = await actions.addSkillAction(fd({ name: 'TypeScript' }));
    expect(res.ok).toBe(true);
  });

  it('other create failures are still reported', async () => {
    mocks.listOwnSkills.mockResolvedValue([]);
    mocks.createOwnSkill.mockRejectedValue(new Error('boom'));
    const res = await actions.addSkillAction(fd({ name: 'Go' }));
    expect(res.ok).toBe(false);
  });

  it('deletes only by session user id', async () => {
    const res = await actions.deleteSkillAction(fd({ id: SKILL, userId: 'evil' }));
    expect(res.ok).toBe(true);
    expect(mocks.deleteOwnSkill).toHaveBeenCalledWith({ tag: 'session' }, USER, SKILL);
  });
});
