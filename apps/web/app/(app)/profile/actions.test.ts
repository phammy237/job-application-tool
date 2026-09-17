import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Real production incident regression suite: every /profile mutation used to let
 * `<schema>.parse()` (and any DB error) throw straight out of a plain `<form action={fn}>`,
 * completely uncaught, which Next.js turns into a full "Application error: a server-side
 * exception has occurred" crash page. A perfectly ordinary input — typing "linkedin.com/in/name"
 * into LinkedIn without "https://", which `profileLinksSchema`'s `.url()` rejects — reproduced
 * this every time. These tests prove every mutation now returns `{ error }` instead.
 */

/** Mimics Next.js's real redirect() throw shape (a plain Error whose `.digest` starts with
 * "NEXT_REDIRECT") — the exact control-flow exception `requireUser()` throws for an
 * unauthenticated caller, and the one thing this file's try/catch blocks must never swallow. */
class MockNextRedirectError extends Error {
  digest = 'NEXT_REDIRECT;replace;/login;307;';
}

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  upsertOwnProfile: vi.fn(),
  createOwnExperience: vi.fn(),
  updateOwnExperience: vi.fn(),
  deleteOwnExperience: vi.fn(),
  createOwnEducation: vi.fn(),
  updateOwnEducation: vi.fn(),
  deleteOwnEducation: vi.fn(),
  createOwnProject: vi.fn(),
  updateOwnProject: vi.fn(),
  deleteOwnProject: vi.fn(),
  createOwnSkill: vi.fn(),
  deleteOwnSkill: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  upsertOwnProfile: mocks.upsertOwnProfile,
  createOwnExperience: mocks.createOwnExperience,
  updateOwnExperience: mocks.updateOwnExperience,
  deleteOwnExperience: mocks.deleteOwnExperience,
  createOwnEducation: mocks.createOwnEducation,
  updateOwnEducation: mocks.updateOwnEducation,
  deleteOwnEducation: mocks.deleteOwnEducation,
  createOwnProject: mocks.createOwnProject,
  updateOwnProject: mocks.updateOwnProject,
  deleteOwnProject: mocks.deleteOwnProject,
  createOwnSkill: mocks.createOwnSkill,
  deleteOwnSkill: mocks.deleteOwnSkill,
}));

vi.mock('../../../lib/auth', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

const {
  addEducation,
  addExperience,
  addProject,
  addSkill,
  deleteExperience,
  updateExperienceApproval,
  updateProfile,
} = await import('./actions');
const { INITIAL_PROFILE_ACTION_STATE } = await import('./profile-action-state');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_CLIENT = { tag: 'session' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_A });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.upsertOwnProfile.mockResolvedValue({ userId: USER_A });
});

function profileFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    fullName: 'Ada Lovelace',
    headline: '',
    email: 'ada@example.com',
    phone: '',
    location: '',
    workAuthorization: '',
    relocationPreference: '',
    linkedin: '',
    portfolio: '',
    github: '',
    website: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(defaults)) fd.set(key, value);
  return fd;
}

describe('"use server" export shape (real crash regression)', () => {
  it('every export of actions.ts is an async function — a "use server" file may export nothing else, and violating this is a real production crash (digest 1808891191, found via live verification, not this schema-validation bug) distinct from the one this file otherwise regression-tests', async () => {
    const actionsModule = await import('./actions');
    for (const [name, value] of Object.entries(actionsModule)) {
      expect(
        typeof value === 'function',
        `"${name}" must be an async function to be exported from a 'use server' file — found ${typeof value}`,
      ).toBe(true);
    }
  });
});

describe('updateProfile', () => {
  it('1. first-time profile save (no existing row) succeeds', async () => {
    const result = await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());
    expect(result).toEqual({ error: null });
    expect(mocks.upsertOwnProfile).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_A,
      expect.objectContaining({ fullName: 'Ada Lovelace' }),
    );
  });

  it('2. editing an existing profile succeeds the same way (upsert, not insert-only)', async () => {
    const result = await updateProfile(
      INITIAL_PROFILE_ACTION_STATE,
      profileFormData({ fullName: 'Ada Lovelace-Byron' }),
    );
    expect(result).toEqual({ error: null });
    expect(mocks.upsertOwnProfile).toHaveBeenCalledTimes(1);
  });

  it('3. nullable/optional fields (blank strings) persist as null, not empty strings', async () => {
    await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());
    const [, , parsed] = mocks.upsertOwnProfile.mock.calls[0] as [
      unknown,
      unknown,
      { headline: string | null; phone: string | null; links: Record<string, unknown> },
    ];
    expect(parsed.headline).toBeNull();
    expect(parsed.phone).toBeNull();
    expect(parsed.links.linkedin).toBeNull();
  });

  it('12. a real-world malformed URL (the actual production crash input) returns an in-form error instead of throwing', async () => {
    const result = await updateProfile(
      INITIAL_PROFILE_ACTION_STATE,
      profileFormData({ linkedin: 'linkedin.com/in/myname' }), // no scheme — fails .url()
    );
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/linkedin/i);
    expect(mocks.upsertOwnProfile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('12b. an invalid email similarly returns an in-form error, never throws', async () => {
    const result = await updateProfile(
      INITIAL_PROFILE_ACTION_STATE,
      profileFormData({ email: 'not-an-email' }),
    );
    expect(result.error).toBeTruthy();
    expect(mocks.upsertOwnProfile).not.toHaveBeenCalled();
  });

  it('13. a database failure returns a safe generic error — never a raw DB/stack message, never a fake success', async () => {
    mocks.upsertOwnProfile.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "profiles_pkey"'),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());

    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/constraint|pkey|duplicate key/i);
    consoleSpy.mockRestore();
  });

  it('10. repeated Save (double-click) never duplicates — upsert is idempotent by construction', async () => {
    await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());
    await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());
    expect(mocks.upsertOwnProfile).toHaveBeenCalledTimes(2);
    // Both calls target the same user_id (the upsert's own onConflict key) — never a second row.
    expect(mocks.upsertOwnProfile.mock.calls[0]?.[1]).toBe(USER_A);
    expect(mocks.upsertOwnProfile.mock.calls[1]?.[1]).toBe(USER_A);
  });

  it('11. revalidatePath runs only after a real success', async () => {
    await updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData());
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('14/16. an unauthenticated save propagates the redirect control-flow exception, never swallowed as a generic error', async () => {
    mocks.requireUser.mockRejectedValue(new MockNextRedirectError());

    await expect(updateProfile(INITIAL_PROFILE_ACTION_STATE, profileFormData())).rejects.toThrow(
      MockNextRedirectError,
    );
    expect(mocks.upsertOwnProfile).not.toHaveBeenCalled();
  });

  it('15. userId always comes from the authenticated session, never the form body', async () => {
    const fd = profileFormData();
    fd.set('userId', USER_B); // even if a client tried to smuggle this in, it isn't read
    await updateProfile(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(mocks.upsertOwnProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_A, expect.anything());
  });
});

describe('child-row mutations (experiences/education/projects/skills)', () => {
  it('5. experiences: add succeeds with zero pre-existing rows', async () => {
    const fd = new FormData();
    fd.set('company', 'Initech');
    fd.set('title', 'Engineer');
    const result = await addExperience(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(result).toEqual({ error: null });
    expect(mocks.createOwnExperience).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_A,
      expect.objectContaining({ company: 'Initech', title: 'Engineer' }),
    );
  });

  it('6. education: add succeeds with zero pre-existing rows', async () => {
    const fd = new FormData();
    fd.set('school', 'State University');
    const result = await addEducation(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(result).toEqual({ error: null });
    expect(mocks.createOwnEducation).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_A,
      expect.objectContaining({ school: 'State University' }),
    );
  });

  it('7. projects: a malformed URL returns an in-form error, never throws', async () => {
    const fd = new FormData();
    fd.set('name', 'Side project');
    fd.set('url', 'not a url');
    const result = await addProject(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(result.error).toBeTruthy();
    expect(mocks.createOwnProject).not.toHaveBeenCalled();
  });

  it('9. skills: add succeeds and defaults to approved (self-entered)', async () => {
    const fd = new FormData();
    fd.set('name', 'TypeScript');
    const result = await addSkill(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(result).toEqual({ error: null });
    expect(mocks.createOwnSkill).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_A,
      expect.objectContaining({ name: 'TypeScript', userApproved: true }),
    );
  });

  it('4. an empty required field (company blank) returns an in-form error, never throws', async () => {
    const fd = new FormData();
    fd.set('company', '');
    fd.set('title', 'Engineer');
    const result = await addExperience(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(result.error).toBeTruthy();
    expect(mocks.createOwnExperience).not.toHaveBeenCalled();
  });

  it('bound delete/approval actions still resolve to the correct id and user', async () => {
    const EXPERIENCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await deleteExperience.bind(null, EXPERIENCE_ID)(INITIAL_PROFILE_ACTION_STATE);
    expect(mocks.deleteOwnExperience).toHaveBeenCalledWith(SESSION_CLIENT, USER_A, EXPERIENCE_ID);

    const fd = new FormData();
    fd.set('userApproved', 'on');
    await updateExperienceApproval.bind(null, EXPERIENCE_ID)(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(mocks.updateOwnExperience).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_A,
      EXPERIENCE_ID,
      expect.objectContaining({ userApproved: true }),
    );
  });

  it('15. cross-user isolation — every write is scoped to the session user, never a client-supplied id', async () => {
    mocks.requireUser.mockResolvedValue({ id: USER_B });
    const fd = new FormData();
    fd.set('company', 'Initech');
    fd.set('title', 'Engineer');
    await addExperience(INITIAL_PROFILE_ACTION_STATE, fd);
    expect(mocks.createOwnExperience).toHaveBeenCalledWith(SESSION_CLIENT, USER_B, expect.anything());
  });
});

// 8. Leadership: Candidate Profile has no structured "leadership" table (only flat
// candidate_facts rows with no organization/role/date shape) — this is a pre-existing,
// deliberate Phase 7C design decision (see packages/shared/src/lib/resume-content-from-profile.ts's
// own doc comment), not something this bugfix adds or should invent. Nothing to regression-test
// here beyond what packages/shared/src/lib/resume-content-from-profile.test.ts already covers
// ("never populates leadership — no structured source table exists").
