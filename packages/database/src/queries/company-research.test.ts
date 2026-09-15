import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  createCompanyResearchSnapshot,
  getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication,
} from './company-research';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_ID = '55555555-5555-4555-8555-555555555555';
const FINDING_ID = '66666666-6666-4666-8666-666666666666';

describe('listOwnCompanyResearchSnapshotsForApplication', () => {
  it('returns an empty array when there are no snapshots, without querying children', () => {
    const snapshotChain: Record<string, unknown> = {};
    snapshotChain.select = vi.fn(() => snapshotChain);
    snapshotChain.eq = vi.fn(() => snapshotChain);
    snapshotChain.order = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn(() => snapshotChain);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    return listOwnCompanyResearchSnapshotsForApplication(
      supabase,
      USER_ID,
      APPLICATION_ID,
    ).then((result) => {
      expect(result).toEqual([]);
      expect(from).toHaveBeenCalledTimes(1);
    });
  });

  it('batches source/finding counts across snapshots in two queries, ordered newest first', async () => {
    const snapshotChain: Record<string, unknown> = {};
    snapshotChain.select = vi.fn(() => snapshotChain);
    snapshotChain.eq = vi.fn(() => snapshotChain);
    snapshotChain.order = vi.fn().mockResolvedValue({
      data: [
        {
          id: SNAPSHOT_ID,
          company_name: 'Acme',
          role_title: 'Engineer',
          researched_at: '2026-09-15T00:00:00Z',
        },
      ],
      error: null,
    });

    const sourceChain: Record<string, unknown> = {};
    sourceChain.select = vi.fn(() => sourceChain);
    sourceChain.eq = vi.fn(() => sourceChain);
    sourceChain.in = vi
      .fn()
      .mockResolvedValue({
        data: [{ snapshot_id: SNAPSHOT_ID }, { snapshot_id: SNAPSHOT_ID }],
        error: null,
      });

    const findingChain: Record<string, unknown> = {};
    findingChain.select = vi.fn(() => findingChain);
    findingChain.eq = vi.fn(() => findingChain);
    findingChain.in = vi
      .fn()
      .mockResolvedValue({ data: [{ snapshot_id: SNAPSHOT_ID }], error: null });

    const from = vi.fn((table: string) => {
      if (table === 'company_research_snapshots') return snapshotChain;
      if (table === 'company_research_sources') return sourceChain;
      return findingChain;
    });
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await listOwnCompanyResearchSnapshotsForApplication(
      supabase,
      USER_ID,
      APPLICATION_ID,
    );
    expect(result).toEqual([
      {
        id: SNAPSHOT_ID,
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-15T00:00:00Z',
        sourceCount: 2,
        findingCount: 1,
      },
    ]);
  });
});

describe('getOwnCompanyResearchSnapshot', () => {
  it('returns null when not found or not owned', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnCompanyResearchSnapshot(supabase, USER_ID, SNAPSHOT_ID);
    expect(result).toBeNull();
  });

  it('assembles a full snapshot with findings resolved to their embedded source objects', async () => {
    const snapshotChain: Record<string, unknown> = {};
    snapshotChain.select = vi.fn(() => snapshotChain);
    snapshotChain.eq = vi.fn(() => snapshotChain);
    snapshotChain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: SNAPSHOT_ID,
        user_id: USER_ID,
        application_id: APPLICATION_ID,
        company_name: 'Acme',
        role_title: 'Engineer',
        job_snapshot_id: null,
        researched_at: '2026-09-15T00:00:00Z',
        created_at: '2026-09-15T00:00:00Z',
      },
      error: null,
    });

    function thenableChain(finalResult: { data: unknown; error: null }) {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn().mockResolvedValue(finalResult);
      // Two chained .eq() calls with no terminal method also need to resolve when awaited.
      Object.defineProperty(chain, 'then', {
        value: (resolve: (v: unknown) => void) => resolve(finalResult),
      });
      return chain;
    }

    const sourceChain = thenableChain({
      data: [
        {
          id: SOURCE_ID,
          url: 'https://acme.com/news',
          canonical_url: null,
          title: 'Acme News',
          publisher: 'acme.com',
          source_type: 'OFFICIAL_NEWSROOM',
          published_at: null,
          retrieved_at: '2026-09-15T00:00:00Z',
          evidence_excerpt: 'Acme launched X.',
          content_hash: 'abc',
        },
      ],
      error: null,
    });

    const findingChain = thenableChain({
      data: [
        {
          id: FINDING_ID,
          category: 'PRODUCT',
          claim: 'Acme launched X.',
          role_relevance: 'Relevant to this role.',
          requirement_ids: ['req-1'],
          created_at: '2026-09-15T00:00:00Z',
        },
      ],
      error: null,
    });

    const linkChain = thenableChain({
      data: [{ finding_id: FINDING_ID, source_id: SOURCE_ID }],
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === 'company_research_snapshots') return snapshotChain;
      if (table === 'company_research_sources') return sourceChain;
      if (table === 'company_research_findings') return findingChain;
      return linkChain;
    });
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await getOwnCompanyResearchSnapshot(supabase, USER_ID, SNAPSHOT_ID);
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.sources).toEqual([
      {
        id: SOURCE_ID,
        url: 'https://acme.com/news',
        canonicalUrl: null,
        title: 'Acme News',
        publisher: 'acme.com',
        sourceType: 'OFFICIAL_NEWSROOM',
        publishedAt: null,
        retrievedAt: '2026-09-15T00:00:00Z',
        evidenceExcerpt: 'Acme launched X.',
        contentHash: 'abc',
      },
    ]);
  });
});

describe('createCompanyResearchSnapshot', () => {
  it('calls the RPC with the authenticated user id and maps the result', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { snapshot_id: SNAPSHOT_ID, source_count: 1, finding_count: 1 },
      error: null,
    });
    const rpc = vi.fn(() => ({ single }));
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await createCompanyResearchSnapshot(supabase, USER_ID, {
      applicationId: APPLICATION_ID,
      companyName: 'Acme',
      roleTitle: 'Engineer',
      jobSnapshotId: null,
      sources: [
        {
          id: SOURCE_ID,
          url: 'https://acme.com/news',
          canonicalUrl: null,
          title: 'Acme News',
          publisher: 'acme.com',
          sourceType: 'OFFICIAL_NEWSROOM',
          publishedAt: null,
          evidenceExcerpt: 'Acme launched X.',
          contentHash: 'abc',
        },
      ],
      findings: [
        {
          id: FINDING_ID,
          category: 'PRODUCT',
          claim: 'Acme launched X.',
          roleRelevance: null,
          requirementIds: [],
          sourceIds: [SOURCE_ID],
        },
      ],
    });

    expect(rpc).toHaveBeenCalledWith(
      'create_company_research_snapshot',
      expect.objectContaining({
        p_user_id: USER_ID,
        p_application_id: APPLICATION_ID,
        p_company_name: 'Acme',
      }),
    );
    expect(result).toEqual({ snapshotId: SNAPSHOT_ID, sourceCount: 1, findingCount: 1 });
  });
});
