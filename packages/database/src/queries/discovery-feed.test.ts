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
    is_internship: false,
    role_family: 'SOFTWARE_ENGINEERING',
    first_seen_at: '2026-01-01T00:00:00.000Z',
    match_score: 87.5,
    coverage: 90,
    eligibility_status: 'ELIGIBLE',
    tracked_application_id: null,
    tracked_application_status: null,
    canonical_apply_url: 'https://boards.greenhouse.io/acme/jobs/1234',
    source_url: null,
    apply_url: 'https://boards.greenhouse.io/acme/jobs/1234',
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

  it('maps a joined tracked application (D6) without altering Match/Coverage/Eligibility', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        feedRow({
          match_score: 70,
          coverage: 60,
          eligibility_status: 'ELIGIBLE',
          tracked_application_id: 'eeeeeeee-0000-4000-8000-000000000001',
          tracked_application_status: 'IN_PROGRESS',
        }),
      ],
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS);
    expect(page.items[0]?.trackedApplicationId).toBe('eeeeeeee-0000-4000-8000-000000000001');
    expect(page.items[0]?.trackedApplicationStatus).toBe('IN_PROGRESS');
    expect(page.items[0]?.matchScore).toBe(70);
    expect(page.items[0]?.coverage).toBe(60);
    expect(page.items[0]?.eligibilityStatus).toBe('ELIGIBLE');
  });

  it('maps is_internship straight through, independent of normalized_employment_type', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [feedRow({ normalized_employment_type: 'FULL_TIME', is_internship: true })],
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS);
    expect(page.items[0]?.isInternship).toBe(true);
    expect(page.items[0]?.normalizedEmploymentType).toBe('FULL_TIME');
  });

  it('D7.1 — maps canonical_apply_url/source_url/apply_url straight through', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        feedRow({
          canonical_apply_url: 'https://boards.greenhouse.io/acme/jobs/9999',
          source_url: 'https://jobright.ai/jobs/info/abc123',
          apply_url: 'https://jobright.ai/jobs/info/abc123',
        }),
      ],
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS);
    expect(page.items[0]?.canonicalApplyUrl).toBe('https://boards.greenhouse.io/acme/jobs/9999');
    expect(page.items[0]?.sourceUrl).toBe('https://jobright.ai/jobs/info/abc123');
    expect(page.items[0]?.applyUrl).toBe('https://jobright.ai/jobs/info/abc123');
  });

  it('maps an untracked result to null tracked-application fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [feedRow()], error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const page = await listOwnDiscoveryFeed(supabase, EMPTY_FILTERS);
    expect(page.items[0]?.trackedApplicationId).toBeNull();
    expect(page.items[0]?.trackedApplicationStatus).toBeNull();
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
      resolution_status: 'NOT_ATTEMPTED',
      resolution_strategy: null,
      resolution_confidence: null,
      resolution_candidate_url: null,
      resolution_attempt_count: 0,
      resolution_last_attempt_at: null,
      resolution_link_check_failures: 0,
      content_hash: 'hash',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const chains: Record<string, ReturnType<typeof chainFor>> = {
      job_catalog: chainFor(jobRow),
      job_catalog_features: chainFor(null),
      user_job_match_scores: chainFor(null),
      applications: chainFor(null),
    };
    const from = vi.fn((table: string) => chains[table]);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await getOwnDiscoveryFeedJobDetail(supabase, USER_ID, JOB_ID);
    expect(result?.job.id).toBe(JOB_ID);
    expect(result?.features).toBeNull();
    expect(result?.matchScore).toBeNull();
    expect(result?.trackedApplication).toBeNull();
  });

  it('includes the caller\'s own tracked application when one is linked to this catalog job', async () => {
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
      resolution_status: 'NOT_ATTEMPTED',
      resolution_strategy: null,
      resolution_confidence: null,
      resolution_candidate_url: null,
      resolution_attempt_count: 0,
      resolution_last_attempt_at: null,
      resolution_link_check_failures: 0,
      content_hash: 'hash',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const appRow = {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      user_id: USER_ID,
      job_id: null,
      resume_id: null,
      company: 'Acme',
      title: 'Software Engineer',
      status: 'SAVED',
      notes: null,
      applied_at: null,
      location: null,
      source_url: null,
      canonical_url: null,
      ats_provider: null,
      external_id: null,
      autofill_summary: null,
      unresolved_fields: null,
      job_snapshot_id: null,
      submission_packet_id: null,
      working_resume_version_id: null,
      job_catalog_id: JOB_ID,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const chains: Record<string, ReturnType<typeof chainFor>> = {
      job_catalog: chainFor(jobRow),
      job_catalog_features: chainFor(null),
      user_job_match_scores: chainFor(null),
      applications: chainFor(appRow),
    };
    const from = vi.fn((table: string) => chains[table]);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await getOwnDiscoveryFeedJobDetail(supabase, USER_ID, JOB_ID);
    expect(result?.trackedApplication?.id).toBe(appRow.id);
    expect(result?.trackedApplication?.status).toBe('SAVED');
    expect(result?.trackedApplication?.jobCatalogId).toBe(JOB_ID);
  });
});
