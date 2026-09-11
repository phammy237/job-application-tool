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
}));

vi.mock('@career-os/database', () => ({
  changeOwnApplicationStatus: mocks.changeOwnApplicationStatus,
  markOwnApplicationApplied: mocks.markOwnApplicationApplied,
  createOwnApplication: mocks.createOwnApplication,
  deleteOwnApplication: mocks.deleteOwnApplication,
  revertApplicationEvent: mocks.revertApplicationEvent,
  updateOwnApplication: mocks.updateOwnApplication,
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

const { changeApplicationStatus, createApplication, markApplicationApplied } =
  await import('./actions');

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
