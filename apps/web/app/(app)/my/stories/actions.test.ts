import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  createOwnStory: vi.fn(),
  deleteOwnStory: vi.fn(),
  replaceOwnEdgesFrom: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnStory: mocks.createOwnStory,
  deleteOwnStory: mocks.deleteOwnStory,
  getOwnStory: vi.fn(),
  replaceOwnEdgesFrom: mocks.replaceOwnEdgesFrom,
  updateOwnStory: vi.fn(),
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const actions = await import('./actions');

const USER = '22222222-2222-4222-8222-222222222222';
const STORY = '11111111-1111-4111-8111-111111111111';
const CLIENT = { tag: 'session' };

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER });
  mocks.createClient.mockResolvedValue(CLIENT);
});

describe('story actions', () => {
  it('delete redirects to the list with a fixed notice code', async () => {
    await expect(actions.deleteStoryAction(fd({ id: STORY }))).rejects.toThrow(
      'REDIRECT:/my/stories?notice=deleted',
    );
    expect(mocks.deleteOwnStory).toHaveBeenCalledWith(CLIENT, USER, STORY);
  });

  it('delete reports a failure without redirecting', async () => {
    mocks.deleteOwnStory.mockRejectedValue(new Error('boom'));
    const res = await actions.deleteStoryAction(fd({ id: STORY }));
    expect(res.ok).toBe(false);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('create deletes the story when link syncing fails', async () => {
    mocks.createOwnStory.mockResolvedValue({ id: STORY });
    mocks.replaceOwnEdgesFrom.mockRejectedValue(new Error('boom'));
    const res = await actions.createStoryAction(fd({ title: 'A story' }));
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Could not save the story.');
    expect(mocks.deleteOwnStory).toHaveBeenCalledWith(CLIENT, USER, STORY);
  });
});
