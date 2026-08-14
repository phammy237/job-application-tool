import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
  generateRequirementMapping: vi.fn(),
  getCurrentOwnRequirementMappingRun: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  listCurrentOwnRequirementMappings: vi.fn(),
}));

vi.mock('@career-os/ai', () => ({
  generateRequirementMapping: mocks.generateRequirementMapping,
}));

vi.mock('@career-os/database', () => ({
  getCurrentOwnRequirementMappingRun: mocks.getCurrentOwnRequirementMappingRun,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  listCurrentOwnRequirementMappings: mocks.listCurrentOwnRequirementMappings,
}));

vi.mock('../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET, POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = 'snap-1';
const RUN_ID = 'run-1';

function requestFor(method: string): Request {
  return new Request(`http://localhost/api/job-snapshots/${SNAPSHOT_ID}/requirements`, { method });
}

const paramsArg = { params: Promise.resolve({ id: SNAPSHOT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
});

describe('POST /api/job-snapshots/:id/requirements', () => {
  it('returns 401 when there is no authenticated session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(401);
    expect(mocks.generateRequirementMapping).not.toHaveBeenCalled();
  });

  it('calls generateRequirementMapping with the session-derived user id, never a client-supplied one', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({ status: 'promoted', runId: RUN_ID, mappingCount: 3 });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(mocks.generateRequirementMapping).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { jobSnapshotId: SNAPSHOT_ID },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'promoted', runId: RUN_ID, mappingCount: 3 });
  });

  it('returns 404 for snapshot_not_found', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({ status: 'snapshot_not_found' });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(404);
  });

  it('returns 429 with usage info for rate_limited', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 50, aiRequestLimit: 50, aiRequestPeriodStartedAt: '2026-01-01' },
    });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(429);
  });

  it('returns 502 for provider_error', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({ status: 'provider_error', message: 'timeout' });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(502);
  });

  it('returns 200 with an honest insufficient_facts status, not an error', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({ status: 'insufficient_facts' });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'insufficient_facts' });
  });

  it('returns 502 for validation_failed', async () => {
    mocks.generateRequirementMapping.mockResolvedValue({ status: 'validation_failed' });
    const response = await POST(requestFor('POST'), paramsArg);
    expect(response.status).toBe(502);
  });
});

describe('GET /api/job-snapshots/:id/requirements', () => {
  it('returns 401 when there is no authenticated session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(requestFor('GET'), paramsArg);
    expect(response.status).toBe(401);
  });

  it('returns 404 when the snapshot does not exist or is not owned by the caller', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue(null);
    const response = await GET(requestFor('GET'), paramsArg);
    expect(response.status).toBe(404);
    expect(mocks.getCurrentOwnRequirementMappingRun).not.toHaveBeenCalled();
  });

  it('returns run: null and no mappings when no CURRENT run exists yet', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue({ id: SNAPSHOT_ID });
    mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue(null);
    const response = await GET(requestFor('GET'), paramsArg);
    expect(await response.json()).toEqual({ run: null, mappings: [] });
    expect(mocks.listCurrentOwnRequirementMappings).not.toHaveBeenCalled();
  });

  it('returns the current run and its live-validity-enriched mappings, scoped by the session user id', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue({ id: SNAPSHOT_ID });
    mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue({ id: RUN_ID, status: 'CURRENT' });
    mocks.listCurrentOwnRequirementMappings.mockResolvedValue([{ id: 'mapping-1' }]);

    const response = await GET(requestFor('GET'), paramsArg);

    expect(mocks.listCurrentOwnRequirementMappings).toHaveBeenCalledWith(expect.anything(), USER_ID, RUN_ID);
    expect(await response.json()).toEqual({ run: { id: RUN_ID, status: 'CURRENT' }, mappings: [{ id: 'mapping-1' }] });
  });
});
