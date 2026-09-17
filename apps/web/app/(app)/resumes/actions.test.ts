import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  createOwnResume: vi.fn(),
  createOwnResumeVersion: vi.fn(),
  listOwnResumeVersionsForResume: vi.fn(),
  listOwnResumes: vi.fn(),
  getOwnProfile: vi.fn(),
  listOwnExperiences: vi.fn(),
  listOwnEducation: vi.fn(),
  listOwnProjects: vi.fn(),
  listOwnSkills: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnResume: mocks.createOwnResume,
  createOwnResumeVersion: mocks.createOwnResumeVersion,
  listOwnResumeVersionsForResume: mocks.listOwnResumeVersionsForResume,
  listOwnResumes: mocks.listOwnResumes,
  getOwnProfile: mocks.getOwnProfile,
  listOwnExperiences: mocks.listOwnExperiences,
  listOwnEducation: mocks.listOwnEducation,
  listOwnProjects: mocks.listOwnProjects,
  listOwnSkills: mocks.listOwnSkills,
  deleteOwnResume: vi.fn(),
  deleteOwnResumeVersion: vi.fn(),
  updateOwnResume: vi.fn(),
}));

vi.mock('../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { createMasterResumeVersionFromProfile } = await import('./actions');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const MASTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_CLIENT = { tag: 'session' };
const ADMIN_CLIENT = { tag: 'admin' };

const APPROVED_EXPERIENCE = {
  id: 'e1', userId: USER_ID, sourceFactId: null, company: 'Acme', title: 'Engineer',
  location: null, employmentType: null, startDate: null, endDate: null,
  description: 'Did things.', tags: [], displayOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  userApproved: true, approvedForApplications: true, visibleOnPublicProfile: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.createAdminClient.mockReturnValue(ADMIN_CLIENT);
  mocks.getOwnProfile.mockResolvedValue({
    userId: USER_ID, fullName: 'Jane Doe', headline: null, email: null, phone: null,
    location: null, workAuthorization: null, relocationPreference: null,
    links: {}, publicSlug: null, visibleOnPublicProfile: false, onboardingCompletedAt: null,
  });
  mocks.listOwnExperiences.mockResolvedValue([APPROVED_EXPERIENCE]);
  mocks.listOwnEducation.mockResolvedValue([]);
  mocks.listOwnProjects.mockResolvedValue([]);
  mocks.listOwnSkills.mockResolvedValue([]);
  mocks.listOwnResumeVersionsForResume.mockResolvedValue([]);
  mocks.createOwnResumeVersion.mockResolvedValue({ id: 'version-1' });
});

describe('createMasterResumeVersionFromProfile', () => {
  it('1/2. creates the MASTER container and a STRUCTURED_V1 version populated from approved profile data when none exists', async () => {
    mocks.listOwnResumes.mockResolvedValue([]);
    mocks.createOwnResume.mockResolvedValue({ id: MASTER_ID, kind: 'MASTER' });

    const result = await createMasterResumeVersionFromProfile();

    expect(result).toEqual({ status: 'ok' });
    expect(mocks.createOwnResume).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      expect.objectContaining({ kind: 'MASTER' }),
    );
    const [client, userId, input] = mocks.createOwnResumeVersion.mock.calls[0] as [
      unknown, string, { resumeId: string; snapshotFormat: string; snapshotPayload: { experience: unknown[] } },
    ];
    expect(client).toBe(ADMIN_CLIENT);
    expect(userId).toBe(USER_ID);
    expect(input.resumeId).toBe(MASTER_ID);
    expect(input.snapshotFormat).toBe('STRUCTURED_V1');
    expect(input.snapshotPayload.experience).toHaveLength(1);
  });

  it('3. does not create a second MASTER container when one already exists', async () => {
    mocks.listOwnResumes.mockResolvedValue([{ id: MASTER_ID, kind: 'MASTER', name: 'My Resume' }]);

    await createMasterResumeVersionFromProfile();

    expect(mocks.createOwnResume).not.toHaveBeenCalled();
  });

  it('4. adds a NEW version rather than mutating an existing structured version — no update call exists in this path at all', async () => {
    mocks.listOwnResumes.mockResolvedValue([{ id: MASTER_ID, kind: 'MASTER', name: 'My Resume' }]);
    mocks.listOwnResumeVersionsForResume.mockResolvedValue([
      { id: 'old-version', versionNumber: 1, snapshotFormat: 'STRUCTURED_V1', snapshotPayload: { experience: [] } },
    ]);

    await createMasterResumeVersionFromProfile();

    // Only ever a create call — this module imports no updateOwnResumeVersion at all.
    expect(mocks.createOwnResumeVersion).toHaveBeenCalledTimes(1);
    const [, , input] = mocks.createOwnResumeVersion.mock.calls[0] as [unknown, unknown, { displayName: string }];
    expect(input.displayName).toBe('Version 2'); // the next version, not a replacement of version 1
  });

  it('12. full_name never becomes the account email — uses the real profile name', async () => {
    mocks.listOwnResumes.mockResolvedValue([]);
    mocks.createOwnResume.mockResolvedValue({ id: MASTER_ID, kind: 'MASTER' });
    mocks.getOwnProfile.mockResolvedValue({
      userId: USER_ID, fullName: null, headline: null, email: 'real@example.com', phone: null,
      location: null, workAuthorization: null, relocationPreference: null,
      links: {}, publicSlug: null, visibleOnPublicProfile: false, onboardingCompletedAt: null,
    });

    await createMasterResumeVersionFromProfile();

    const [, , input] = mocks.createOwnResumeVersion.mock.calls[0] as [
      unknown, unknown, { snapshotPayload: { header: { fullName: string } } },
    ];
    expect(input.snapshotPayload.header.fullName).not.toBe('real@example.com');
    expect(input.snapshotPayload.header.fullName).toBe('Your Name');
  });
});
