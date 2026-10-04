import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';

const mocks = vi.hoisted(() => ({
  listOwnApplicationsEligibleForAutoTailorDraft: vi.fn(),
  hasOwnPendingResumeTailoringDraft: vi.fn(),
  createOwnPendingResumeTailoringDraft: vi.fn(),
  generateResumeTailoringPlan: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnApplicationsEligibleForAutoTailorDraft: mocks.listOwnApplicationsEligibleForAutoTailorDraft,
  hasOwnPendingResumeTailoringDraft: mocks.hasOwnPendingResumeTailoringDraft,
  createOwnPendingResumeTailoringDraft: mocks.createOwnPendingResumeTailoringDraft,
}));

vi.mock('./generate-resume-tailoring-plan', () => ({
  generateResumeTailoringPlan: mocks.generateResumeTailoringPlan,
}));

const { runAutoTailorDraftsForUser } = await import('./run-auto-tailor-drafts');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;

function application(id: string) {
  return { id, company: 'Acme', title: 'Engineer' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([]);
  mocks.hasOwnPendingResumeTailoringDraft.mockResolvedValue(false);
  mocks.createOwnPendingResumeTailoringDraft.mockResolvedValue(undefined);
  mocks.generateResumeTailoringPlan.mockResolvedValue({ status: 'ok', proposal: { fake: true } });
});

describe('runAutoTailorDraftsForUser', () => {
  it('drafts for every eligible application up to the per-run cap', async () => {
    mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([
      application('app-1'),
      application('app-2'),
      application('app-3'),
    ]);

    const result = await runAutoTailorDraftsForUser(FAKE_SUPABASE, USER_ID, {
      maxDraftsPerUserPerRun: 2,
    });

    expect(mocks.generateResumeTailoringPlan).toHaveBeenCalledTimes(2);
    expect(mocks.createOwnPendingResumeTailoringDraft).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ eligible: 3, drafted: 2, skippedExisting: 0, rateLimited: false });
  });

  it('skips an application that already has a pending draft, without calling Claude for it', async () => {
    mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([
      application('already-pending'),
      application('fresh'),
    ]);
    mocks.hasOwnPendingResumeTailoringDraft.mockImplementation(
      async (_s, _u, id) => id === 'already-pending',
    );

    const result = await runAutoTailorDraftsForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.generateResumeTailoringPlan).toHaveBeenCalledTimes(1);
    expect(mocks.generateResumeTailoringPlan).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ applicationId: 'fresh' }),
    );
    expect(result).toMatchObject({ drafted: 1, skippedExisting: 1 });
  });

  it('stops early once a call comes back rate_limited, never trying the remaining applications', async () => {
    mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([
      application('app-1'),
      application('app-2'),
      application('app-3'),
    ]);
    mocks.generateResumeTailoringPlan
      .mockResolvedValueOnce({ status: 'ok', proposal: { fake: true } })
      .mockResolvedValueOnce({ status: 'rate_limited', usage: {} });

    const result = await runAutoTailorDraftsForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.generateResumeTailoringPlan).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ drafted: 1, rateLimited: true });
  });

  it('skips a non-ok, non-rate-limited result without throwing and continues to the next application', async () => {
    mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([
      application('bad-format'),
      application('good'),
    ]);
    mocks.generateResumeTailoringPlan
      .mockResolvedValueOnce({ status: 'unsupported_resume_format' })
      .mockResolvedValueOnce({ status: 'ok', proposal: { fake: true } });

    const result = await runAutoTailorDraftsForUser(FAKE_SUPABASE, USER_ID);

    expect(mocks.createOwnPendingResumeTailoringDraft).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ drafted: 1 });
  });

  it("isolates one application's unexpected throw from the rest of the batch", async () => {
    mocks.listOwnApplicationsEligibleForAutoTailorDraft.mockResolvedValue([
      application('throws'),
      application('fine'),
    ]);
    mocks.generateResumeTailoringPlan.mockImplementation(async (_s, _u, params) => {
      if (params.applicationId === 'throws') throw new Error('boom');
      return { status: 'ok', proposal: { fake: true } };
    });

    const result = await runAutoTailorDraftsForUser(FAKE_SUPABASE, USER_ID);

    expect(result).toMatchObject({ drafted: 1 });
  });
});
