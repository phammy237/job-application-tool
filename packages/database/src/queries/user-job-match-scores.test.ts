import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  getOwnMatchScore,
  listOwnAutoQueueCandidateMatchScores,
  listOwnMatchScoresForJobCatalogIds,
  upsertUserJobMatchScoresBatch,
} from './user-job-match-scores';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const JOB_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const BASE_ROW = {
  id: 'cccccccc-0000-4000-8000-000000000001',
  user_id: USER_ID,
  job_catalog_id: JOB_ID,
  match_score: 87.78,
  coverage: 90,
  eligibility_status: 'ELIGIBLE',
  score_components: [],
  eligibility_checks: [],
  ranking_version: 'd4-ranking-v1',
  feature_version: 'd4-features-v1',
  eligibility_version: 'd4-eligibility-v1',
  computed_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('getOwnMatchScore', () => {
  it('parses a row scoped by both user_id and job_catalog_id', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnMatchScore(supabase, USER_ID, JOB_ID);
    expect(result?.matchScore).toBe(87.78);
    expect(result?.coverage).toBe(90);
    expect(result?.eligibilityStatus).toBe('ELIGIBLE');
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.eq).toHaveBeenCalledWith('job_catalog_id', JOB_ID);
  });

  it('returns null when no score exists', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
    expect(await getOwnMatchScore(supabase, USER_ID, JOB_ID)).toBeNull();
  });
});

describe('upsertUserJobMatchScoresBatch', () => {
  it('upserts on the (user_id, job_catalog_id) unique constraint with every entry stamped with the given user', async () => {
    const chain: Record<string, unknown> = {};
    chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await upsertUserJobMatchScoresBatch(
      supabase,
      USER_ID,
      [
        {
          jobCatalogId: JOB_ID,
          matchScore: 87.78,
          coverage: 90,
          eligibilityStatus: 'ELIGIBLE',
          scoreComponents: [],
          eligibilityChecks: [],
          rankingVersion: 'd4-ranking-v1',
          featureVersion: 'd4-features-v1',
          eligibilityVersion: 'd4-eligibility-v1',
        },
      ],
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const upsertMock = chain.upsert as ReturnType<typeof vi.fn>;
    expect(upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: USER_ID,
          job_catalog_id: JOB_ID,
          match_score: 87.78,
          coverage: 90,
          eligibility_status: 'ELIGIBLE',
        }),
      ],
      { onConflict: 'user_id,job_catalog_id' },
    );
  });

  it('is a no-op for an empty batch (no upsert call at all)', async () => {
    const chain: Record<string, unknown> = {};
    chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
    await upsertUserJobMatchScoresBatch(supabase, USER_ID, []);
    expect(chain.upsert).not.toHaveBeenCalled();
  });
});

describe('listOwnAutoQueueCandidateMatchScores', () => {
  it('filters on user_id, HIGH coverage, non-CONFLICT eligibility, and the given match-score floor', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.neq = vi.fn(() => chain);
    chain.gte = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn().mockResolvedValue({ data: [BASE_ROW], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnAutoQueueCandidateMatchScores(supabase, USER_ID, {
      minMatchScore: 70,
      limit: 25,
    });

    expect(result).toHaveLength(1);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.eq).toHaveBeenCalledWith('coverage_bucket', 0);
    expect(chain.neq).toHaveBeenCalledWith('eligibility_status', 'CONFLICT');
    expect(chain.gte).toHaveBeenCalledWith('match_score', 70);
    expect(chain.limit).toHaveBeenCalledWith(25);
  });
});

describe('listOwnMatchScoresForJobCatalogIds', () => {
  it('returns an empty map without a network call for an empty input', async () => {
    const supabase = { from: vi.fn() } as unknown as CareerOsSupabaseClient;
    const result = await listOwnMatchScoresForJobCatalogIds(supabase, USER_ID, []);
    expect(result.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('keys the returned map by job_catalog_id', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({ data: [BASE_ROW], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnMatchScoresForJobCatalogIds(supabase, USER_ID, [JOB_ID]);
    expect(result.get(JOB_ID)?.matchScore).toBe(87.78);
    expect(chain.in).toHaveBeenCalledWith('job_catalog_id', [JOB_ID]);
  });
});
