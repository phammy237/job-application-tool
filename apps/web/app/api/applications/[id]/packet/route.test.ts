import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
  getOwnApplication: vi.fn(),
  getOwnSubmissionPacketByApplicationId: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  getOwnSubmissionPacketByApplicationId: mocks.getOwnSubmissionPacketByApplicationId,
}));

vi.mock('../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const PARAMS = { params: Promise.resolve({ id: APPLICATION_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

describe('GET /api/applications/[id]/packet', () => {
  it('returns 401 when there is no authenticated session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.getOwnApplication).not.toHaveBeenCalled();
  });

  it('returns 404 when the application does not exist or is not owned by the caller', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(404);
    expect(mocks.getOwnSubmissionPacketByApplicationId).not.toHaveBeenCalled();
  });

  it('returns packet: null as a legitimate 200 when no packet exists yet (not APPLIED, or a legacy row)', async () => {
    mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ packet: null });
  });

  it('returns the packet for an owned, APPLIED application', async () => {
    mocks.getOwnApplication.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
    const packet = { id: 'p1', applicationId: APPLICATION_ID, answersSnapshot: [] };
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(packet);
    const response = await GET(new Request('http://localhost'), PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ packet });
    expect(mocks.getOwnSubmissionPacketByApplicationId).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      APPLICATION_ID,
    );
  });
});
