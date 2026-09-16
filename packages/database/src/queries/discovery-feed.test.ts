import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryFeedFilters } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  getOwnDiscoveryFeedJobDetail,
  listDiscoveryLocationTokens,
  listOwnDiscoveryFeed,
} from './discovery-feed';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const JOB_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const EMPTY_FILTERS: DiscoveryFeedFilters = {
  search: null,
  roleFamilies: null,
  locationToken: null,
  workplaceTypes: null,
  employmentTypes: null,
  eligibilityStatuses: null,
  minMatch: null,
  minCoverage: null,
  freshnessDays: null,
  page: 1,
};

function feedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    job_catalog_id: JOB_ID,
    title: 'Software Engineer',
    company_name: 'Acme',
    location_text: 'Remote',
    normalized_workplace_type: 'REMOTE',
    normalized_employment_type: 'FULL_TIME',
    role_family: 'SOFTWARE_ENGINEERING',
    first_seen_at: '2026-01-01T00:00:00.000Z',
    match_score: 87.5,
    coverage: 90,
    eligibility_status: 'ELIGIBLE',
    ...overrides,
  };
}

describe('listOwnDiscoveryFeed', () => {
  it('maps filters to RPC args, requesting pageSize + 1 rows at the right offset', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [feedRow()], error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const filters: DiscoveryFeedFilters = {
      ...EMPTY_FILTERS,
      search: 'engineer',
      roleFamilies: ['SOFTWARE_ENGINEERING'],
      workplaceTypes: ['REMOTE', 'HYBRID'],
      minMatch: 50,
      page: 3,
    };

    await listOwnDiscoveryFeed(supabase, filters, { pageSize: 20 });

    expect(rpc).toHaveBeenCalledWith('list_own_discovery_feed', {
      p_search: 'engineer',
      p_role_families: ['SOFTWARE_ENGINEERING'],
      p_location_token: null,
      p_workplace_types: ['REMOTE', 'HYBRID'],
      p_employment_types: null,
      p_eligibility_statuses: null,
      p_min_match: 50,
      p_min_coverage: null,
      p_freshness_days: null,
      p_limit: 21,
      p_offset: 40, // (page 3 - 1) * pageSize 20
    });
  });

  function uuidFor(i: number): string {
    return `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`;
  }

  it('reports hasNextPage true and slices off the extra row when limit+1 rows come back', async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      feedRow({ job_catalog_id: uuidFor(i), title: `Job ${i}` }),
    );
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS, { pageSize: 20 });
    expect(page.items).toHaveLength(20);
    expect(page.hasNextPage).toBe(true);
  });

  it('reports hasNextPage false when fewer than limit+1 rows come back', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => feedRow({ job_catalog_id: uuidFor(i) }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS, { pageSize: 20 });
    expect(page.items).toHaveLength(5);
    expect(page.hasNextPage).toBe(false);
  });

  it('preserves Match, Coverage, and Eligibility as separate fields, never combined', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [feedRow({ match_score: 12, coverage: 95, eligibility_status: 'CONFLICT' })],
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS);
    expect(page.items[0]?.matchScore).toBe(12);
    expect(page.items[0]?.coverage).toBe(95);
    expect(page.items[0]?.eligibilityStatus).toBe('CONFLICT');
  });
});

describe('listDiscoveryLocationTokens', () => {
  it('flattens the RPC rows into plain strings', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ location_token: 'NEW_YORK_NY' }, { location_token: 'REMOTE_US' }],
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;
    expect(await listDiscoveryLocationTokens(supabase)).toEqual(['NEW_YORK_NY', 'REMOTE_US']);
  });
});

describe('getOwnDiscoveryFeedJobDetail', () => {
  function chainFor(data: unknown) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    return chain;
  }

  it('returns null immediately when the job does not exist, without querying features or score', async () => {
    const jobChain = chainFor(null);
    const from = vi.fn(() => jobChain);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await getOwnDiscoveryFeedJobDetail(supabase, USER_ID, JOB_ID);
    expect(result).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('job_catalog');
  });

  it('composes job, features, and the caller\'s own match score, with matchScore null when none exists yet', async () => {
    const jobRow = {
      id: JOB_ID,
      source_id: 'dddddddd-0000-4000-8000-000000000001',
      source_job_id: 'ext-1',
      company_name: 'Acme',
      title: 'Software Engineer',
      normalized_title: 'software engineer',
      location_text: 'Remote',
      normalized_location: 'remote',
      city: null,
      state_region: null,
      country: null,
      workplace_type: 'REMOTE',
      employment_type: 'Full-time',
      description: 'desc',
      responsibilities: null,
      qualifications: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      apply_url: 'https://example.com/apply',
      source_url: 'https://example.com/job',
      canonical_apply_url: null,
      dedupe_fingerprint: 'fp',
      posted_at: null,
      source_updated_at: null,
      first_seen_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      content_updated_at: '2026-01-01T00:00:00.000Z',
      consecutive_misses: 0,
      status: 'ACTIVE',
      closed_at: null,
      content_hash: 'hash',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const chains: Record<string, ReturnType<typeof chainFor>> = {
      job_catalog: chainFor(jobRow),
      job_catalog_features: chainFor(null),
      user_job_match_scores: chainFor(null),
    };
    const from = vi.fn((table: string) => chains[table]);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await getOwnDiscoveryFeedJobDetail(supabase, USER_ID, JOB_ID);
    expect(result?.job.id).toBe(JOB_ID);
    expect(result?.features).toBeNull();
    expect(result?.matchScore).toBeNull();
  });
});
