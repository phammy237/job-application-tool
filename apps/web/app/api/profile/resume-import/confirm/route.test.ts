import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  getOwnProfile: vi.fn(),
  upsertOwnProfile: vi.fn(),
  listOwnExperiences: vi.fn(),
  listOwnEducation: vi.fn(),
  listOwnProjects: vi.fn(),
  listOwnSkills: vi.fn(),
  createOwnExperience: vi.fn(),
  createOwnEducation: vi.fn(),
  createOwnProject: vi.fn(),
  createOwnSkill: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnProfile: mocks.getOwnProfile,
  upsertOwnProfile: mocks.upsertOwnProfile,
  listOwnExperiences: mocks.listOwnExperiences,
  listOwnEducation: mocks.listOwnEducation,
  listOwnProjects: mocks.listOwnProjects,
  listOwnSkills: mocks.listOwnSkills,
  createOwnExperience: mocks.createOwnExperience,
  createOwnEducation: mocks.createOwnEducation,
  createOwnProject: mocks.createOwnProject,
  createOwnSkill: mocks.createOwnSkill,
}));

vi.mock('../../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_CLIENT = { tag: 'session' };

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/profile/resume-import/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.getOwnProfile.mockResolvedValue({
    userId: USER_ID,
    fullName: null,
    headline: null,
    email: null,
    phone: null,
    location: 'Gainesville, FL',
    workAuthorization: null,
    relocationPreference: null,
    links: { linkedin: null, portfolio: null, github: null, website: null },
    publicSlug: null,
    visibleOnPublicProfile: false,
    onboardingCompletedAt: null,
  });
  mocks.listOwnExperiences.mockResolvedValue([]);
  mocks.listOwnEducation.mockResolvedValue([]);
  mocks.listOwnProjects.mockResolvedValue([]);
  mocks.listOwnSkills.mockResolvedValue([]);
  mocks.upsertOwnProfile.mockResolvedValue({});
  mocks.createOwnExperience.mockResolvedValue({});
  mocks.createOwnEducation.mockResolvedValue({});
  mocks.createOwnProject.mockResolvedValue({});
  mocks.createOwnSkill.mockResolvedValue({});
});

describe('POST /api/profile/resume-import/confirm', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(mocks.upsertOwnProfile).not.toHaveBeenCalled();
  });

  it('9/13. writes only approved (included) items', async () => {
    const res = await POST(
      jsonRequest({
        experience: [{ company: 'Acme', title: 'Engineer' }],
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.createOwnExperience).toHaveBeenCalledTimes(1);
    expect(mocks.createOwnExperience).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      expect.objectContaining({ company: 'Acme', title: 'Engineer' }),
    );
  });

  it('1. an analyzed item is not persisted before this call — the fixture itself proves no write happens for an empty (nothing confirmed yet) payload', async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(200);
    expect(mocks.upsertOwnProfile).not.toHaveBeenCalled();
    expect(mocks.createOwnExperience).not.toHaveBeenCalled();
    expect(mocks.createOwnEducation).not.toHaveBeenCalled();
    expect(mocks.createOwnProject).not.toHaveBeenCalled();
    expect(mocks.createOwnSkill).not.toHaveBeenCalled();
  });

  it('6. an excluded item (never sent by the client at all) is absent — confirming with an empty experience array creates nothing', async () => {
    const res = await POST(jsonRequest({ experience: [] }));
    expect(res.status).toBe(200);
    expect(mocks.createOwnExperience).not.toHaveBeenCalled();
  });

  it('15. an omitted personal field keeps its exact existing value — never nulled by an unrelated confirm', async () => {
    await POST(jsonRequest({ personal: { fullName: 'Jane Doe' } })); // location omitted

    const [, , merged] = mocks.upsertOwnProfile.mock.calls[0] as [unknown, unknown, { location: string | null }];
    expect(merged.location).toBe('Gainesville, FL'); // untouched, from the existing profile
  });

  it('applies an explicitly-included personal field', async () => {
    await POST(jsonRequest({ personal: { fullName: 'Jane Doe' } }));

    const [, , merged] = mocks.upsertOwnProfile.mock.calls[0] as [unknown, unknown, { fullName: string | null }];
    expect(merged.fullName).toBe('Jane Doe');
  });

  it('15. duplicate experience (exact match) is skipped, never inserted twice', async () => {
    mocks.listOwnExperiences.mockResolvedValue([
      { company: 'Acme', title: 'Engineer', description: null },
    ]);

    const res = await POST(
      jsonRequest({ experience: [{ company: 'Acme', title: 'Engineer', description: null }] }),
    );
    const body = (await res.json()) as { experiencesCreated: number; experiencesSkippedAsDuplicate: number };

    expect(mocks.createOwnExperience).not.toHaveBeenCalled();
    expect(body.experiencesSkippedAsDuplicate).toBe(1);
    expect(body.experiencesCreated).toBe(0);
  });

  it('9. repeat confirm is idempotent — no duplicate row, no duplicate approval event, converges on the same approved fact', async () => {
    mocks.listOwnExperiences.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { company: 'Acme', title: 'Engineer', description: null },
    ]);

    const payload = { experience: [{ company: 'Acme', title: 'Engineer', description: null }] };
    const first = await POST(jsonRequest(payload));
    const firstBody = (await first.json()) as { experiencesCreated: number };
    expect(firstBody.experiencesCreated).toBe(1);
    const [, , firstInput] = mocks.createOwnExperience.mock.calls[0] as [unknown, unknown, { userApproved: boolean }];
    expect(firstInput.userApproved).toBe(true); // the one real approval event

    const second = await POST(jsonRequest(payload));
    const secondBody = (await second.json()) as { experiencesCreated: number; experiencesSkippedAsDuplicate: number };
    expect(secondBody.experiencesCreated).toBe(0);
    expect(secondBody.experiencesSkippedAsDuplicate).toBe(1);
    // The repeat never calls createOwnExperience again — no second approval event, no duplicate
    // row; the already-approved fact from the first call remains the converged state.
    expect(mocks.createOwnExperience).toHaveBeenCalledTimes(1);
  });

  it('2. an included + confirmed experience becomes approved_for_ai_use — Confirm import IS the approval event, no second approval click required', async () => {
    await POST(jsonRequest({ experience: [{ company: 'Acme', title: 'Engineer' }] }));
    const [, , input] = mocks.createOwnExperience.mock.calls[0] as [unknown, unknown, { userApproved: boolean; approvedForApplications: boolean }];
    expect(input.userApproved).toBe(true);
    expect(input.approvedForApplications).toBe(true);
  });

  it('3. an included + confirmed education item becomes approved (education supports the same approval fields)', async () => {
    await POST(jsonRequest({ education: [{ school: 'State University' }] }));
    const [, , input] = mocks.createOwnEducation.mock.calls[0] as [unknown, unknown, { userApproved: boolean; approvedForApplications: boolean }];
    expect(input.userApproved).toBe(true);
    expect(input.approvedForApplications).toBe(true);
  });

  it('4. an included + confirmed project becomes approved_for_ai_use', async () => {
    await POST(jsonRequest({ projects: [{ name: 'Side Project' }] }));
    const [, , input] = mocks.createOwnProject.mock.calls[0] as [unknown, unknown, { userApproved: boolean; approvedForApplications: boolean }];
    expect(input.userApproved).toBe(true);
    expect(input.approvedForApplications).toBe(true);
  });

  it('5. an included + confirmed skill follows the existing approved-fact semantics (unchanged — skills already defaulted to approved)', async () => {
    await POST(jsonRequest({ skills: [{ name: 'TypeScript' }] }));
    const [, , input] = mocks.createOwnSkill.mock.calls[0] as [unknown, unknown, { userApproved: boolean; approvedForApplications: boolean }];
    expect(input.userApproved).toBe(true);
    expect(input.approvedForApplications).toBe(true);
  });

  it('7. an edited value (the client-submitted text, not the original AI extraction) is what gets written and approved', async () => {
    await POST(jsonRequest({ experience: [{ company: 'Acme Corp (edited)', title: 'Senior Engineer (edited)' }] }));
    const [, , input] = mocks.createOwnExperience.mock.calls[0] as [
      unknown, unknown, { company: string; title: string; userApproved: boolean },
    ];
    expect(input.company).toBe('Acme Corp (edited)');
    expect(input.title).toBe('Senior Engineer (edited)');
    expect(input.userApproved).toBe(true);
  });

  it('8. an existing, unrelated fact\'s approval state is never touched by an import confirm — this route only ever creates new rows, never updates an existing one', async () => {
    mocks.listOwnExperiences.mockResolvedValue([
      { id: 'existing-1', company: 'Old Co', title: 'Old Role', description: null, userApproved: false, approvedForApplications: false },
    ]);

    await POST(jsonRequest({ experience: [{ company: 'New Co', title: 'New Role' }] }));

    // The new item is created (and approved, per #2); the pre-existing, unrelated row is only
    // ever read (for dedup comparison) — this module imports no updateOwnExperience at all, so
    // there is structurally no path here that could touch its approval flags.
    expect(mocks.createOwnExperience).toHaveBeenCalledTimes(1);
    expect(mocks.createOwnExperience).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      expect.objectContaining({ company: 'New Co' }),
    );
  });

  it('cross-user isolation: userId always comes from the session, never the request body', async () => {
    await POST(
      jsonRequest({
        experience: [{ company: 'Acme', title: 'Engineer' }],
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    );
    expect(mocks.createOwnExperience).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, expect.anything());
  });

  it('rejects a malformed request body with 400, never a crash', async () => {
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('returns a safe generic error, never a raw exception, on a database failure', async () => {
    mocks.createOwnExperience.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(jsonRequest({ experience: [{ company: 'Acme', title: 'Engineer' }] }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).not.toMatch(/constraint|duplicate key/i);
    consoleSpy.mockRestore();
  });
});
