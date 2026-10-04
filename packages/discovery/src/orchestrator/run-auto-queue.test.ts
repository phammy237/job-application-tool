import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';

const mocks = vi.hoisted(() => ({
  getJobCatalogEntryById: vi.fn(),
  getJobCatalogFeatures: vi.fn(),
  getJobSource: vi.fn(),
  listOwnApplicationsPendingAutoQueueReview: vi.fn(),
  listOwnAutoQueueCandidateMatchScores: vi.fn(),
  listOwnTrackedJobCatalogIds: vi.fn(),
  markOwnApplicationAutoQueued: vi.fn(),
  startApplicationFromCatalogJob: vi.fn(),
  buildCatalogJobHandoffPayload: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getJobCatalogEntryById: mocks.getJobCatalogEntryById,
  getJobCatalogFeatures: mocks.getJobCatalogFeatures,
  getJobSource: mocks.getJobSource,
  listOwnApplicationsPendingAutoQueueReview: mocks.listOwnApplicationsPendingAutoQueueReview,
  listOwnAutoQueueCandidateMatchScores: mocks.listOwnAutoQueueCandidateMatchScores,
  listOwnTrackedJobCatalogIds: mocks.listOwnTrackedJobCatalogIds,
  markOwnApplicationAutoQueued: mocks.markOwnApplicationAutoQueued,
  startApplicationFromCatalogJob: mocks.startApplicationFromCatalogJob,
}));

vi.mock('../build-catalog-snapshot', () => ({
  buildCatalogJobHandoffPayload: mocks.buildCatalogJobHandoffPayload,
}));

const { runAutoQueueForUser } = await import('./run-auto-queue');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;

function matchScore(jobCatalogId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `score-${jobCatalogId}`,
    userId: USER_ID,
    jobCatalogId,
    matchScore: 80,
    coverage: 70,
    eligibilityStatus: 'ELIGIBLE',
    scoreComponents: [],
    eligibilityChecks: [],
    rankingVersion: 'v1',
    featureVersion: 'v1',
    eligibilityVersion: 'v1',
    computedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOwnApplicationsPendingAutoQueueReview.mockResolvedValue([]);
  mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([]);
  mocks.listOwnTrackedJobCatalogIds.mockResolvedValue(new Set());
  mocks.getJobCatalogEntryById.mockImplementation(async (_s, id) => ({ id, sourceId: 'source-1' }));
  mocks.getJobCatalogFeatures.mockResolvedValue(null);
  mocks.getJobSource.mockResolvedValue(null);
  mocks.buildCatalogJobHandoffPayload.mockResolvedValue({
    snapshot: {},
    snapshotContentFingerprint: 'v1:fp',
    snapshotContentTruncated: false,
    snapshotTruncatedFields: [],
    canonicalUrl: null,
    eventMetadata: {},
  });
  mocks.startApplicationFromCatalogJob.mockImplementation(async (_s, _u, input) => ({
    applicationId: `app-${input.jobCatalogId}`,
    created: true,
    status: 'SAVED',
    jobSnapshotId: null,
  }));
  mocks.markOwnApplicationAutoQueued.mockResolvedValue(undefined);
});

describe('runAutoQueueForUser', () => {
  it('skips the user entirely once their pending-review backlog is at the cap', async () => {
    mocks.listOwnApplicationsPendingAutoQueueReview.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({ id: `pending-${i}` })),
    );

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID, { maxPendingBacklog: 3 });

    expect(result).toEqual({
      userId: USER_ID,
      candidatesConsidered: 0,
      alreadyTracked: 0,
      queued: 0,
      skippedAtBacklogCap: true,
    });
    expect(mocks.listOwnAutoQueueCandidateMatchScores).not.toHaveBeenCalled();
  });

  it('passes the configured threshold and limit through to the candidate query', async () => {
    await runAutoQueueForUser(FAKE_SUPABASE, USER_ID, { maxCandidates: 10 });

    expect(mocks.listOwnAutoQueueCandidateMatchScores).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('never calls startApplicationFromCatalogJob for an already-tracked candidate', async () => {
    mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([
      matchScore('tracked-job'),
      matchScore('new-job'),
    ]);
    mocks.listOwnTrackedJobCatalogIds.mockResolvedValue(new Set(['tracked-job']));

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledTimes(1);
    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ jobCatalogId: 'new-job', eventSource: 'AUTO_QUEUE' }),
    );
    expect(result).toMatchObject({ candidatesConsidered: 2, alreadyTracked: 1, queued: 1 });
  });

  it('queues at most maxNewQueuedPerUser candidates per run', async () => {
    mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([
      matchScore('job-1'),
      matchScore('job-2'),
      matchScore('job-3'),
    ]);

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID, { maxNewQueuedPerUser: 2 });

    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ queued: 2 });
  });

  it('never marks an application auto-queued when startApplicationFromCatalogJob converges onto an existing row (created: false)', async () => {
    mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([matchScore('existing-job')]);
    mocks.startApplicationFromCatalogJob.mockResolvedValue({
      applicationId: 'app-existing',
      created: false,
      status: 'IN_PROGRESS',
      jobSnapshotId: null,
    });

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.markOwnApplicationAutoQueued).not.toHaveBeenCalled();
    expect(result).toMatchObject({ queued: 0 });
  });

  it("isolates one candidate's failure from the rest of the batch", async () => {
    mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([
      matchScore('bad-job'),
      matchScore('good-job'),
    ]);
    mocks.getJobCatalogEntryById.mockImplementation(async (_s, id) => {
      if (id === 'bad-job') throw new Error('catalog read failed');
      return { id, sourceId: 'source-1' };
    });

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledTimes(1);
    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ jobCatalogId: 'good-job' }),
    );
    expect(result).toMatchObject({ queued: 1 });
  });

  it('skips a candidate whose catalog row no longer exists, without throwing', async () => {
    mocks.listOwnAutoQueueCandidateMatchScores.mockResolvedValue([matchScore('vanished-job')]);
    mocks.getJobCatalogEntryById.mockResolvedValue(null);

    const result = await runAutoQueueForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.startApplicationFromCatalogJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ queued: 0 });
  });
});
