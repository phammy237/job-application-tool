import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
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
}));

vi.mock('../../../lib/auth', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { changeApplicationStatus, createApplication } = await import('./actions');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

function formDataWithStatus(status: string): FormData {
  const formData = new FormData();
  formData.set('status', status);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({});
});

describe('changeApplicationStatus', () => {
  it('routes an APPLIED selection through markOwnApplicationApplied, never through changeOwnApplicationStatus', async () => {
    mocks.markOwnApplicationApplied.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'APPLIED',
    });

    await changeApplicationStatus(APPLICATION_ID, formDataWithStatus('APPLIED'));

    expect(mocks.markOwnApplicationApplied).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
    );
    expect(mocks.changeOwnApplicationStatus).not.toHaveBeenCalled();
  });

  it('routes every other status through changeOwnApplicationStatus, never through markOwnApplicationApplied', async () => {
    mocks.changeOwnApplicationStatus.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'INTERVIEW',
    });

    await changeApplicationStatus(APPLICATION_ID, formDataWithStatus('INTERVIEW'));

    expect(mocks.changeOwnApplicationStatus).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
      'INTERVIEW',
    );
    expect(mocks.markOwnApplicationApplied).not.toHaveBeenCalled();
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
