import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Structurally identical to the real class in packages/database/src/queries/consistency.ts —
 * see mark-applied/route.test.ts's identical rationale for why this is a class, not a bare mock
 * object: the action under test does a real `instanceof` check against it. */
class MockConsistencyCheckFailedError extends Error {
  constructor(
    public readonly reason: 'blocking_findings' | 'unacknowledged_warnings',
    public readonly findings: Array<{ severity: 'BLOCKING' | 'WARNING' }>,
  ) {
    super(`Consistency check failed: ${reason}`);
    this.name = 'ConsistencyCheckFailedError';
  }
}

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  changeOwnApplicationStatus: vi.fn(),
  markOwnApplicationApplied: vi.fn(),
  createOwnApplication: vi.fn(),
  deleteOwnApplication: vi.fn(),
  revertApplicationEvent: vi.fn(),
  updateOwnApplication: vi.fn(),
  getOwnApplication: vi.fn(),
  getOwnProfile: vi.fn(),
  listOwnResumes: vi.fn(),
  listOwnResumeVersionsForResume: vi.fn(),
  listOwnExperiences: vi.fn(),
  listOwnEducation: vi.fn(),
  listOwnProjects: vi.fn(),
  listOwnSkills: vi.fn(),
  createOwnResume: vi.fn(),
  createOwnResumeVersion: vi.fn(),
  setOwnApplicationWorkingResumeVersion: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  changeOwnApplicationStatus: mocks.changeOwnApplicationStatus,
  markOwnApplicationApplied: mocks.markOwnApplicationApplied,
  createOwnApplication: mocks.createOwnApplication,
  deleteOwnApplication: mocks.deleteOwnApplication,
  revertApplicationEvent: mocks.revertApplicationEvent,
  updateOwnApplication: mocks.updateOwnApplication,
  getOwnApplication: mocks.getOwnApplication,
  getOwnProfile: mocks.getOwnProfile,
  listOwnResumes: mocks.listOwnResumes,
  listOwnResumeVersionsForResume: mocks.listOwnResumeVersionsForResume,
  listOwnExperiences: mocks.listOwnExperiences,
  listOwnEducation: mocks.listOwnEducation,
  listOwnProjects: mocks.listOwnProjects,
  listOwnSkills: mocks.listOwnSkills,
  createOwnResume: mocks.createOwnResume,
  createOwnResumeVersion: mocks.createOwnResumeVersion,
  setOwnApplicationWorkingResumeVersion: mocks.setOwnApplicationWorkingResumeVersion,
  ConsistencyCheckFailedError: MockConsistencyCheckFailedError,
}));

vi.mock('../../../lib/auth', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const {
  changeApplicationStatus,
  createApplication,
  createTailoredResumeForApplication,
  markApplicationApplied,
  revertEvent,
} = await import('./actions');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_CLIENT = { tag: 'session-scoped' };
const ADMIN_CLIENT = { tag: 'admin' };

function formDataWithStatus(status: string): FormData {
  const formData = new FormData();
  formData.set('status', status);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.createAdminClient.mockReturnValue(ADMIN_CLIENT);
});

describe('changeApplicationStatus', () => {
  it('routes an APPLIED selection through markOwnApplicationApplied using the admin client, never through changeOwnApplicationStatus', async () => {
    mocks.markOwnApplicationApplied.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'APPLIED',
    });

    await changeApplicationStatus(APPLICATION_ID, formDataWithStatus('APPLIED'));

    // Phase 5B.1: mark_application_applied is service-role-only, so this must use the admin
    // client, not the session-scoped one — a real integration bug that a mocked test alone
    // wouldn't catch if the assertion only checked "was called", not "called with which client".
    expect(mocks.markOwnApplicationApplied).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      USER_ID,
      APPLICATION_ID,
    );
    expect(mocks.changeOwnApplicationStatus).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('routes every other status through changeOwnApplicationStatus using the session-scoped client, never through markOwnApplicationApplied', async () => {
    mocks.changeOwnApplicationStatus.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'INTERVIEW',
    });

    await changeApplicationStatus(APPLICATION_ID, formDataWithStatus('INTERVIEW'));

    expect(mocks.changeOwnApplicationStatus).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      APPLICATION_ID,
      'INTERVIEW',
    );
    expect(mocks.markOwnApplicationApplied).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe('markApplicationApplied', () => {
  it('returns ok and the new status on success, using the admin client', async () => {
    mocks.markOwnApplicationApplied.mockResolvedValue({ status: 'APPLIED' });

    const result = await markApplicationApplied(APPLICATION_ID, ['w1']);

    expect(mocks.markOwnApplicationApplied).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      USER_ID,
      APPLICATION_ID,
      {
        acknowledgedFindingIds: ['w1'],
      },
    );
    expect(result).toEqual({ status: 'ok', applicationStatus: 'APPLIED' });
  });

  it('returns a consistency_check_failed result (not a thrown error) when the gate rejects', async () => {
    const findings = [{ severity: 'BLOCKING' as const }];
    mocks.markOwnApplicationApplied.mockRejectedValue(
      new MockConsistencyCheckFailedError('blocking_findings', findings),
    );

    const result = await markApplicationApplied(APPLICATION_ID, []);

    expect(result).toEqual({
      status: 'consistency_check_failed',
      reason: 'blocking_findings',
      findings,
    });
  });

  it('returns a generic error result, never leaking not-found vs not-owned, for any other failure', async () => {
    mocks.markOwnApplicationApplied.mockRejectedValue(
      new Error('application not found or not owned'),
    );

    const result = await markApplicationApplied(APPLICATION_ID, []);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).not.toMatch(/owned|another/i);
    }
  });
});

describe('createApplication', () => {
  function formDataForCreate(status: string): FormData {
    const formData = new FormData();
    formData.set('company', 'Acme');
    formData.set('title', 'Engineer');
    formData.set('status', status);
    return formData;
  }

  it('rejects status APPLIED before ever calling createOwnApplication — the "Add application" form cannot directly create an APPLIED row (docs/IMPLEMENTATION_PLAN.md Phase 5B.0)', async () => {
    await expect(createApplication(formDataForCreate('APPLIED'))).rejects.toThrow();
    expect(mocks.createOwnApplication).not.toHaveBeenCalled();
  });

  it('still creates an application with a legitimate non-APPLIED status', async () => {
    mocks.createOwnApplication.mockResolvedValue({ id: APPLICATION_ID, status: 'SAVED' });

    await createApplication(formDataForCreate('SAVED'));

    expect(mocks.createOwnApplication).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ company: 'Acme', title: 'Engineer', status: 'SAVED' }),
    );
  });
});

describe('createTailoredResumeForApplication', () => {
  const RESUME_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MASTER_RESUME_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NEW_VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const BASE_VERSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const APPLICATION = {
    id: APPLICATION_ID,
    company: 'Acme',
    title: 'Engineer',
  };

  const DISPLAY_NAME = "My Resume's Resume -- Acme -- Engineer"; // overwritten per-test via profile.fullName

  function profile(fullName: string | null) {
    return {
      userId: USER_ID,
      fullName,
      headline: null,
      email: 'candidate@example.com',
      phone: null,
      location: null,
      workAuthorization: null,
      relocationPreference: null,
      links: {},
      publicSlug: null,
      visibleOnPublicProfile: false,
    };
  }

  const APPROVAL_FIELDS = { userApproved: true, approvedForApplications: true };

  function approvedExperience() {
    return {
      id: 'ee000000-0000-4000-8000-000000000001',
      userId: USER_ID,
      sourceFactId: null,
      company: 'Initech',
      title: 'Engineer',
      location: null,
      employmentType: null,
      startDate: null,
      endDate: null,
      description: 'Built things.',
      tags: [],
      displayOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...APPROVAL_FIELDS,
    };
  }

  const STRUCTURED_CONTENT = {
    schemaVersion: 1,
    header: { fullName: 'Base Resume Owner', email: null, phone: null, location: null, links: {} },
    education: [],
    experience: [{ organization: 'Initech', role: 'Engineer' }],
    projects: [],
    leadership: [],
    skills: [],
    renderOverride: null,
  };

  beforeEach(() => {
    mocks.getOwnApplication.mockResolvedValue(APPLICATION);
    mocks.getOwnProfile.mockResolvedValue(profile('Jane Doe'));
    mocks.listOwnResumes.mockResolvedValue([]);
    mocks.listOwnResumeVersionsForResume.mockResolvedValue([]);
    mocks.listOwnExperiences.mockResolvedValue([]);
    mocks.listOwnEducation.mockResolvedValue([]);
    mocks.listOwnProjects.mockResolvedValue([]);
    mocks.listOwnSkills.mockResolvedValue([]);
    mocks.createOwnResume.mockResolvedValue({ id: RESUME_ID, name: DISPLAY_NAME, kind: 'TAILORED' });
    mocks.createOwnResumeVersion.mockResolvedValue({ id: NEW_VERSION_ID });
    mocks.setOwnApplicationWorkingResumeVersion.mockResolvedValue(undefined);
  });

  it('1. clones the MASTER resume\'s latest structured version when one exists (source A)', async () => {
    mocks.listOwnResumes.mockResolvedValue([
      { id: MASTER_RESUME_ID, name: 'Master', kind: 'MASTER', parentResumeId: null },
    ]);
    mocks.listOwnResumeVersionsForResume.mockResolvedValue([
      { id: BASE_VERSION_ID, snapshotFormat: 'STRUCTURED_V1', snapshotPayload: STRUCTURED_CONTENT },
    ]);

    await createTailoredResumeForApplication(APPLICATION_ID);

    expect(mocks.createOwnResumeVersion).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        snapshotFormat: 'STRUCTURED_V1',
        snapshotPayload: STRUCTURED_CONTENT,
      }),
    );
    // 2. Structured content is copied verbatim, not summarized/regenerated.
    const call = mocks.createOwnResumeVersion.mock.calls[0]?.[2] as { snapshotPayload: unknown };
    expect(call.snapshotPayload).toBe(STRUCTURED_CONTENT); // same reference — a true clone, not a rebuild
    // Never falls back to profile import when a real base version exists.
    expect(mocks.listOwnExperiences).not.toHaveBeenCalled();
  });

  it('3. never mutates or re-saves the original base version', async () => {
    mocks.listOwnResumes.mockResolvedValue([
      { id: MASTER_RESUME_ID, name: 'Master', kind: 'MASTER', parentResumeId: null },
    ]);
    mocks.listOwnResumeVersionsForResume.mockResolvedValue([
      { id: BASE_VERSION_ID, snapshotFormat: 'STRUCTURED_V1', snapshotPayload: STRUCTURED_CONTENT },
    ]);

    await createTailoredResumeForApplication(APPLICATION_ID);

    // createOwnResumeVersion is create-only (a new row); the base version id is never passed to
    // any write call — only read via listOwnResumeVersionsForResume.
    for (const call of mocks.createOwnResumeVersion.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(BASE_VERSION_ID);
    }
  });

  it('4. initializes from approved profile data when no structured base resume exists (source B)', async () => {
    mocks.listOwnResumes.mockResolvedValue([]); // no MASTER at all
    mocks.listOwnExperiences.mockResolvedValue([approvedExperience()]);

    await createTailoredResumeForApplication(APPLICATION_ID);

    const call = mocks.createOwnResumeVersion.mock.calls[0]?.[2] as {
      snapshotFormat: string;
      snapshotPayload: { experience: unknown[]; header: { fullName: string } };
    };
    expect(call.snapshotFormat).toBe('STRUCTURED_V1');
    expect(call.snapshotPayload.experience).toHaveLength(1);
    expect(call.snapshotPayload.header.fullName).toBe('Jane Doe');
  });

  it('5. creates a genuinely blank draft only when neither a base resume nor approved profile data exists (source C)', async () => {
    mocks.listOwnResumes.mockResolvedValue([]);
    // every listOwn* already resolves to [] via beforeEach

    await createTailoredResumeForApplication(APPLICATION_ID);

    const call = mocks.createOwnResumeVersion.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(call.snapshotFormat).toBeUndefined();
    expect(call.snapshotPayload).toBeUndefined();
  });

  it('6. never uses the account email as "Full name" — falls back to the generic placeholder instead', async () => {
    mocks.getOwnProfile.mockResolvedValue(profile(null)); // no real name set, matching the real incident
    mocks.listOwnExperiences.mockResolvedValue([approvedExperience()]);

    await createTailoredResumeForApplication(APPLICATION_ID);

    const call = mocks.createOwnResumeVersion.mock.calls[0]?.[2] as {
      snapshotPayload: { header: { fullName: string } };
    };
    expect(call.snapshotPayload.header.fullName).not.toBe('candidate@example.com');
    expect(call.snapshotPayload.header.fullName).toBe('Your Name');
  });

  it('7. links the application to the newly created version', async () => {
    await createTailoredResumeForApplication(APPLICATION_ID);

    expect(mocks.setOwnApplicationWorkingResumeVersion).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
      NEW_VERSION_ID,
    );
  });

  it('reuses the existing resume/version on a repeat call instead of creating a duplicate (double-click regression — the real account ended up with two identically named resumes)', async () => {
    const existingVersion = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', versionNumber: 1 };
    mocks.listOwnResumes.mockResolvedValue([
      { id: RESUME_ID, name: "Jane Doe's Resume -- Acme -- Engineer", kind: 'TAILORED', parentResumeId: null },
    ]);
    mocks.listOwnResumeVersionsForResume.mockResolvedValue([existingVersion]);

    await createTailoredResumeForApplication(APPLICATION_ID);

    expect(mocks.createOwnResume).not.toHaveBeenCalled();
    expect(mocks.createOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.setOwnApplicationWorkingResumeVersion).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
      existingVersion.id,
    );
  });
});

describe('revertEvent', () => {
  const EVENT_ID = '55555555-5555-4555-8555-555555555555';

  it('uses the admin client, not the session-scoped one (Phase 5B hardening: migration 0015 only permits a service_role-executed write to restore APPLIED)', async () => {
    mocks.revertApplicationEvent.mockResolvedValue({ id: EVENT_ID });

    await revertEvent(APPLICATION_ID, EVENT_ID);

    expect(mocks.revertApplicationEvent).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      USER_ID,
      EVENT_ID,
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
