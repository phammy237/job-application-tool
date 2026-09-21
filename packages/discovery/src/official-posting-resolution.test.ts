import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import { buildCrossSourceDedupeIndex } from './dedupe/cross-source-dedupe';
import {
  mergeIntoAtsMatch,
  resolveViaCatalogMatch,
  resolveViaSearch,
  runOfficialPostingResolution,
} from './official-posting-resolution';

/** Minimal in-memory multi-table fake mirroring the exact PostgREST call shapes this module's
 * database-layer callees issue (`job_sources`, `job_catalog`, `user_job_match_scores`) — same
 * technique as `orchestrator/sync-source.test.ts`, extended with `.delete()`. */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}
interface FakeTables {
  job_sources: FakeRow[];
  job_catalog: FakeRow[];
  user_job_match_scores: FakeRow[];
}
class FakeStore {
  tables: FakeTables = { job_sources: [], job_catalog: [], user_job_match_scores: [] };
}
class FakeQuery {
  private op: 'select' | 'update' | 'delete' | null = null;
  private filters: Array<['eq' | 'in', string, unknown]> = [];
  private selectCols: string[] | null = null;
  private payload: Record<string, unknown> | null = null;

  constructor(
    private readonly store: FakeStore,
    private readonly table: keyof FakeTables,
  ) {}

  select(cols: string): this {
    this.op = 'select';
    this.selectCols = cols.split(',').map((c) => c.trim());
    return this;
  }
  order(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push(['eq', col, value]);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push(['in', col, values]);
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }

  private rows(): FakeRow[] {
    return this.store.tables[this.table];
  }
  private matches(row: FakeRow): boolean {
    return this.filters.every(([kind, col, value]) => {
      if (kind === 'eq') return row[col] === value;
      return (value as unknown[]).includes(row[col]);
    });
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    const matched = this.rows().find((row) => this.matches(row)) ?? null;
    if (!matched) return { data: null, error: null };
    const picked: Record<string, unknown> = {};
    for (const col of this.selectCols ?? []) picked[col] = col === '*' ? matched : matched[col];
    return { data: this.selectCols?.includes('*') ? matched : picked, error: null };
  }

  then(resolve: (value: { data: unknown; error: null }) => void, reject: (reason: unknown) => void): void {
    try {
      resolve(this.execute());
    } catch (error) {
      reject(error);
    }
  }

  private execute(): { data: unknown; error: null } {
    if (this.op === 'select') {
      const matched = this.rows().filter((row) => this.matches(row));
      const data = matched.map((row) => {
        if (this.selectCols?.includes('*')) return row;
        const picked: Record<string, unknown> = {};
        for (const col of this.selectCols ?? []) picked[col] = row[col];
        return picked;
      });
      return { data, error: null };
    }
    if (this.op === 'update') {
      for (const row of this.rows().filter((r) => this.matches(r))) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    if (this.op === 'delete') {
      const remaining = this.rows().filter((row) => !this.matches(row));
      this.store.tables[this.table] = remaining;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}
function fakeSupabase(store: FakeStore): CareerOsSupabaseClient {
  return { from: (table: keyof FakeTables) => new FakeQuery(store, table) } as unknown as CareerOsSupabaseClient;
}

vi.mock('@career-os/ai', () => ({ tavilySearch: vi.fn() }));
import { tavilySearch } from '@career-os/ai';
const mockedTavilySearch = vi.mocked(tavilySearch);

afterEach(() => {
  vi.clearAllMocks();
});

const GREENHOUSE_ROW = {
  jobCatalogId: 'gh-1',
  sourceId: 'source-greenhouse',
  companyName: 'Datadog',
  title: 'Product Management Intern',
  locationText: 'New York, NY, United States',
  canonicalApplyUrl: 'https://boards.greenhouse.io/datadog/jobs/1234',
  postedAt: '2026-09-15T00:00:00.000Z',
};
const LEVER_ROW = {
  jobCatalogId: 'lever-1',
  sourceId: 'source-lever',
  companyName: 'Palantir',
  title: 'Forward Deployed Engineer Intern',
  locationText: 'Palo Alto, CA, United States',
  canonicalApplyUrl: 'https://jobs.lever.co/palantir/5678',
  postedAt: '2026-09-14T00:00:00.000Z',
};
const ASHBY_ROW = {
  jobCatalogId: 'ashby-1',
  sourceId: 'source-ashby',
  companyName: 'Notion',
  title: 'Data Science Intern',
  locationText: 'San Francisco, CA, United States',
  canonicalApplyUrl: 'https://jobs.ashbyhq.com/notion/9012',
  postedAt: '2026-09-13T00:00:00.000Z',
};

describe('resolveViaCatalogMatch (Strategy A)', () => {
  it('1. a Jobright row matches an existing Greenhouse job', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      postedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('gh-1');
  });

  it('2. a Jobright row matches an existing Lever job', () => {
    const index = buildCrossSourceDedupeIndex([LEVER_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Palantir',
      title: 'Forward Deployed Engineer Intern',
      locationText: 'Palo Alto, CA, United States',
      postedAt: null,
    });
    expect(match?.jobCatalogId).toBe('lever-1');
  });

  it('3. a Jobright row matches an existing Ashby job', () => {
    const index = buildCrossSourceDedupeIndex([ASHBY_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Notion',
      title: 'Data Science Intern',
      locationText: 'San Francisco, CA, United States',
      postedAt: '2026-09-13T00:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('ashby-1');
  });

  it('4. the same title in a different location never false-matches', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'San Francisco, CA, United States',
      postedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });

  it('5. the same company with a genuinely different requisition (far-apart posted dates) never false-matches', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });
});

describe('resolveViaSearch (Strategy B)', () => {
  const CANDIDATE = { companyName: 'Databricks', title: 'Product Management Intern (Summer 2027)', locationText: 'San Francisco, CA' };

  it('accepts a HIGH-confidence result and confirms it is reachable', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://boards.greenhouse.io/databricks/jobs/1234',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring a Product Management Intern for Summer 2027 in San Francisco, CA.',
          publishedDate: null,
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    if (result.tier === 'RESOLVED_HIGH_CONFIDENCE') {
      expect(result.url).toBe('https://boards.greenhouse.io/databricks/jobs/1234');
    }
    vi.unstubAllGlobals();
  });

  it('returns UNRESOLVED when every result is an aggregator or a weak match', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://www.linkedin.com/jobs/view/1234',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring.',
          publishedDate: null,
        },
      ],
    });
    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('returns UNRESOLVED when search is unavailable (no API key configured)', async () => {
    mockedTavilySearch.mockResolvedValue({ status: 'unavailable' });
    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('UNRESOLVED');
  });
});

describe('mergeIntoAtsMatch', () => {
  it('appends the cross-source observation, deletes match scores, and marks the row MERGED', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push(
      { id: 'ats-1', cross_source_observations: [], status: 'ACTIVE' },
      {
        id: 'jobright-1',
        status: 'ACTIVE',
        resolution_status: 'NOT_ATTEMPTED',
        resolution_attempt_count: 0,
        source_url: 'https://jobright.ai/jobs/info/abc123',
        canonical_apply_url: 'https://jobright.ai/jobs/info/abc123',
      },
    );
    store.tables.user_job_match_scores.push(
      { id: 'score-1', job_catalog_id: 'jobright-1' },
      { id: 'score-2', job_catalog_id: 'ats-1' },
    );
    const supabase = fakeSupabase(store);

    await mergeIntoAtsMatch(
      supabase,
      {
        jobrightJobCatalogId: 'jobright-1',
        atsJobCatalogId: 'ats-1',
        sourceIdentifier: 'jobright-ai/2026-Product-Management-Internship',
        sourceJobId: 'abc123',
        sourceUrl: 'https://jobright.ai/jobs/info/abc123',
      },
      new Date('2026-09-18T00:00:00.000Z'),
    );

    const atsRow = store.tables.job_catalog.find((r) => r.id === 'ats-1')!;
    expect(atsRow.cross_source_observations).toEqual([
      {
        provider: 'JOBRIGHT_GITHUB',
        sourceIdentifier: 'jobright-ai/2026-Product-Management-Internship',
        sourceJobId: 'abc123',
        sourceUrl: 'https://jobright.ai/jobs/info/abc123',
        observedAt: '2026-09-18T00:00:00.000Z',
      },
    ]);

    const jobrightRow = store.tables.job_catalog.find((r) => r.id === 'jobright-1')!;
    expect(jobrightRow.status).toBe('MERGED');
    expect(jobrightRow.resolution_status).toBe('RESOLVED_HIGH_CONFIDENCE');
    expect(jobrightRow.resolution_strategy).toBe('CATALOG_MATCH');
    // 19. source_url (discovery provenance) is never touched by a merge — only status/resolution_*.
    expect(jobrightRow.source_url).toBe('https://jobright.ai/jobs/info/abc123');
    expect(jobrightRow.canonical_apply_url).toBe('https://jobright.ai/jobs/info/abc123');

    // The Jobright row's own match score is gone; the ATS row's own score is untouched.
    expect(store.tables.user_job_match_scores.map((s) => s.job_catalog_id)).toEqual(['ats-1']);
  });
});

describe('runOfficialPostingResolution', () => {
  it('prefers Strategy A over Strategy B — never calls search when a catalog match already exists', async () => {
    const store = new FakeStore();
    function sourceRow(overrides: Partial<FakeRow> & { id: string }): FakeRow {
      return {
        company_name: 'placeholder',
        source_type: 'GREENHOUSE',
        source_identifier: 'placeholder',
        careers_url: null,
        enabled: true,
        crawl_interval_hours: 24,
        last_crawled_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error: null,
        consecutive_failures: 0,
        etag: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }
    store.tables.job_sources.push(
      sourceRow({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        source_type: 'GREENHOUSE',
        source_identifier: 'datadog',
        company_name: 'Datadog',
      }),
      sourceRow({
        id: 'bbbbbbbb-0000-4000-8000-000000000002',
        source_type: 'JOBRIGHT_GITHUB',
        source_identifier: 'jobright-ai/2026-Product-Management-Internship',
        company_name: 'Jobright — Product Management Internships',
      }),
    );
    store.tables.job_catalog.push(
      {
        id: 'ats-1',
        source_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        company_name: 'Datadog',
        title: 'Product Management Intern',
        location_text: 'New York, NY, United States',
        canonical_apply_url: 'https://boards.greenhouse.io/datadog/jobs/1234',
        posted_at: '2026-09-15T00:00:00.000Z',
        status: 'ACTIVE',
        cross_source_observations: [],
      },
      {
        id: 'jobright-1',
        source_id: 'bbbbbbbb-0000-4000-8000-000000000002',
        source_job_id: 'abc123',
        company_name: 'Datadog',
        title: 'Product Management Intern',
        location_text: 'New York, NY, United States',
        canonical_apply_url: 'https://jobright.ai/jobs/info/abc123',
        source_url: 'https://jobright.ai/jobs/info/abc123',
        apply_url: 'https://jobright.ai/jobs/info/abc123',
        posted_at: '2026-09-16T00:00:00.000Z',
        status: 'ACTIVE',
        resolution_status: 'NOT_ATTEMPTED',
        resolution_attempt_count: 0,
        resolution_last_attempt_at: null,
      },
    );
    const supabase = fakeSupabase(store);

    const summary = await runOfficialPostingResolution(
      supabase,
      { jobrightSourceIds: ['bbbbbbbb-0000-4000-8000-000000000002'], atsSourceIds: ['aaaaaaaa-0000-4000-8000-000000000001'] },
      { retryAfterMs: 1000, maxCount: 10, now: new Date('2026-09-18T00:00:00.000Z') },
    );

    expect(summary.mergedIntoAts).toBe(1);
    expect(mockedTavilySearch).not.toHaveBeenCalled();
    const jobrightRow = store.tables.job_catalog.find((r) => r.id === 'jobright-1')!;
    expect(jobrightRow.status).toBe('MERGED');
  });

  it('20/19. falls back to Strategy B when no catalog match exists: canonical_apply_url becomes the resolved employer URL, source_url stays the Jobright detail page', async () => {
    const store = new FakeStore();
    function sourceRow(overrides: Partial<FakeRow> & { id: string }): FakeRow {
      return {
        company_name: 'placeholder',
        source_type: 'JOBRIGHT_GITHUB',
        source_identifier: 'placeholder',
        careers_url: null,
        enabled: true,
        crawl_interval_hours: 24,
        last_crawled_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error: null,
        consecutive_failures: 0,
        etag: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }
    store.tables.job_sources.push(
      sourceRow({
        id: 'cccccccc-0000-4000-8000-000000000003',
        source_identifier: 'jobright-ai/2026-Product-Management-Internship',
      }),
    );
    store.tables.job_catalog.push({
      id: 'jobright-2',
      source_id: 'cccccccc-0000-4000-8000-000000000003',
      source_job_id: 'def456',
      company_name: 'Databricks',
      title: 'Product Management Intern (Summer 2027)',
      location_text: 'San Francisco, CA',
      canonical_apply_url: 'https://jobright.ai/jobs/info/def456',
      source_url: 'https://jobright.ai/jobs/info/def456',
      apply_url: 'https://jobright.ai/jobs/info/def456',
      posted_at: '2026-09-16T00:00:00.000Z',
      status: 'ACTIVE',
      resolution_status: 'NOT_ATTEMPTED',
      resolution_attempt_count: 0,
      resolution_last_attempt_at: null,
    });
    const supabase = fakeSupabase(store);

    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://boards.greenhouse.io/databricks/jobs/9999',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring a Product Management Intern for Summer 2027 in San Francisco, CA.',
          publishedDate: null,
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const summary = await runOfficialPostingResolution(
      supabase,
      { jobrightSourceIds: ['cccccccc-0000-4000-8000-000000000003'], atsSourceIds: [] },
      { retryAfterMs: 1000, maxCount: 10, now: new Date('2026-09-18T00:00:00.000Z') },
    );

    expect(summary.resolvedHighConfidence).toBe(1);
    const row = store.tables.job_catalog.find((r) => r.id === 'jobright-2')!;
    expect(row.canonical_apply_url).toBe('https://boards.greenhouse.io/databricks/jobs/9999');
    expect(row.source_url).toBe('https://jobright.ai/jobs/info/def456');
    expect(row.resolution_strategy).toBe('SEARCH');
    vi.unstubAllGlobals();
  });
});
