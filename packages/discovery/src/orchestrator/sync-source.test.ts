import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import type { JobSource } from '@career-os/shared';
import { syncSource } from './sync-source';
import greenhouseSample from '../adapters/__fixtures__/greenhouse-sample.json';
import greenhouseMalformed from '../adapters/__fixtures__/greenhouse-malformed.json';

/**
 * A minimal in-memory, multi-table fake mirroring the exact PostgREST call shapes the real
 * production code (packages/database's job-sources.ts/job-catalog.ts) issues — see that
 * package's own job-catalog.test.ts for the same technique applied to one table. Generalized
 * here across `job_sources` and `job_catalog` since the orchestrator drives both.
 */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}

interface FakeTables {
  job_sources: FakeRow[];
  job_catalog: FakeRow[];
}

class FakeStore {
  tables: FakeTables = { job_sources: [], job_catalog: [] };
  private nextId = 1;
  genId(): string {
    return `row-${this.nextId++}`;
  }
}

class FakeQuery {
  private op: 'select' | 'upsert' | 'update' | null = null;
  private filters: Array<['eq' | 'in', string, unknown]> = [];
  private selectCols: string[] | null = null;
  private payload: unknown = null;
  private upsertOnConflict: string[] = [];

  constructor(
    private readonly store: FakeStore,
    private readonly table: keyof FakeTables,
  ) {}

  select(cols: string): this {
    this.op = 'select';
    this.selectCols = cols.split(',').map((c) => c.trim());
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

  upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): this {
    this.op = 'upsert';
    this.payload = rows;
    this.upsertOnConflict = opts.onConflict.split(',');
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
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

  then(
    resolve: (value: { data: unknown; error: null }) => void,
    reject: (reason: unknown) => void,
  ): void {
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
      const matched = this.rows().filter((row) => this.matches(row));
      for (const row of matched) Object.assign(row, this.payload as Record<string, unknown>);
      return { data: null, error: null };
    }

    if (this.op === 'upsert') {
      const rows = this.store.tables[this.table];
      for (const incoming of this.payload as Record<string, unknown>[]) {
        const existingIndex = rows.findIndex((row) =>
          this.upsertOnConflict.every((col) => row[col] === incoming[col]),
        );
        if (existingIndex >= 0) {
          const existing = rows[existingIndex] as FakeRow;
          rows[existingIndex] = { ...existing, ...incoming, id: existing.id };
        } else {
          rows.push({ id: this.store.genId(), ...incoming });
        }
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }
}

function fakeSupabase(store: FakeStore): CareerOsSupabaseClient {
  return {
    from: (table: keyof FakeTables) => new FakeQuery(store, table),
  } as unknown as CareerOsSupabaseClient;
}

const SOURCE: JobSource = {
  id: 'aaaaaaaa-0000-4000-8000-000000000000',
  companyName: 'Stripe',
  sourceType: 'GREENHOUSE',
  sourceIdentifier: 'stripe',
  careersUrl: null,
  enabled: true,
  crawlIntervalHours: 24,
  lastCrawledAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The `job_sources` fake table stores DB rows (snake_case), not the camelCase JobSource type —
 * mirrors exactly what getJobSource/recordJobSourceCrawlSuccess/Failure actually read/write. */
function sourceRow(): FakeRow {
  return {
    id: SOURCE.id,
    company_name: SOURCE.companyName,
    source_type: SOURCE.sourceType,
    source_identifier: SOURCE.sourceIdentifier,
    careers_url: SOURCE.careersUrl,
    enabled: SOURCE.enabled,
    crawl_interval_hours: SOURCE.crawlIntervalHours,
    last_crawled_at: SOURCE.lastCrawledAt,
    last_success_at: SOURCE.lastSuccessAt,
    last_error_at: SOURCE.lastErrorAt,
    last_error: SOURCE.lastError,
    consecutive_failures: SOURCE.consecutiveFailures,
    created_at: SOURCE.createdAt,
    updated_at: SOURCE.updatedAt,
  };
}

function mockFetchOnce(options: { ok: boolean; status?: number; json?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: options.ok,
      status: options.status ?? (options.ok ? 200 : 500),
      json: vi.fn().mockResolvedValue(options.json),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncSource', () => {
  it('a successful crawl creates rows and records source success', async () => {
    const store = new FakeStore();
    store.tables.job_sources.push(sourceRow());
    const supabase = fakeSupabase(store);
    mockFetchOnce({ ok: true, json: greenhouseSample });

    const result = await syncSource(supabase, SOURCE, new Date('2026-01-01T00:00:00.000Z'));

    expect(result.outcome).toBe('SUCCESS');
    expect(result.new).toBe(3);
    expect(store.tables.job_catalog).toHaveLength(3);
    const sourceRowAfter = store.tables.job_sources[0];
    expect(sourceRowAfter?.last_success_at).toBe('2026-01-01T00:00:00.000Z');
    expect(sourceRowAfter?.consecutive_failures).toBe(0);
  });

  it('scenario I: one malformed posting among valid ones still ingests the valid ones and counts the rest as rejected, without failing the crawl', async () => {
    const store = new FakeStore();
    store.tables.job_sources.push(sourceRow());
    const supabase = fakeSupabase(store);
    mockFetchOnce({ ok: true, json: greenhouseMalformed });

    const result = await syncSource(supabase, SOURCE, new Date('2026-01-01T00:00:00.000Z'));

    expect(result.outcome).toBe('SUCCESS');
    expect(result.new).toBe(1);
    expect(result.rejected).toBe(4);
    expect(store.tables.job_catalog).toHaveLength(1);
  });

  it('scenario F: a failed crawl records the failure, creates/touches no job_catalog rows, and leaves any existing rows completely unchanged', async () => {
    const store = new FakeStore();
    store.tables.job_sources.push(sourceRow());
    const supabase = fakeSupabase(store);

    // First, a successful crawl to seed some ACTIVE rows.
    mockFetchOnce({ ok: true, json: greenhouseSample });
    await syncSource(supabase, SOURCE, new Date('2026-01-01T00:00:00.000Z'));
    const snapshotBeforeFailure = JSON.parse(JSON.stringify(store.tables.job_catalog));
    expect(snapshotBeforeFailure).toHaveLength(3);

    // Then a failed crawl (HTTP 500) for the same source.
    vi.unstubAllGlobals();
    mockFetchOnce({ ok: false, status: 500, json: { error: 'boom' } });
    const result = await syncSource(supabase, SOURCE, new Date('2026-01-02T00:00:00.000Z'));

    expect(result.outcome).toBe('FAILURE');
    expect(store.tables.job_catalog).toEqual(snapshotBeforeFailure);
    for (const row of store.tables.job_catalog) {
      expect(row.status).toBe('ACTIVE');
      expect(row.consecutive_misses).toBe(0);
    }

    const sourceRowAfter = store.tables.job_sources[0];
    expect(sourceRowAfter?.consecutive_failures).toBe(1);
    expect(sourceRowAfter?.last_error).toBeTruthy();
  });

  it('a subsequent successful crawl missing a previously-seen job marks it POSSIBLY_CLOSED (reconciliation only runs on success)', async () => {
    const store = new FakeStore();
    store.tables.job_sources.push(sourceRow());
    const supabase = fakeSupabase(store);

    mockFetchOnce({ ok: true, json: greenhouseSample });
    await syncSource(supabase, SOURCE, new Date('2026-01-01T00:00:00.000Z'));

    // Second crawl returns only 2 of the 3 original jobs.
    const fewerJobs = {
      jobs: (greenhouseSample as { jobs: unknown[] }).jobs.slice(0, 2),
      meta: { total: 2 },
    };
    vi.unstubAllGlobals();
    mockFetchOnce({ ok: true, json: fewerJobs });
    const result = await syncSource(supabase, SOURCE, new Date('2026-01-02T00:00:00.000Z'));

    expect(result.outcome).toBe('SUCCESS');
    expect(result.possiblyClosed).toBe(1);
    const missingRow = store.tables.job_catalog.find((r) => r.source_job_id === '8200002');
    expect(missingRow?.status).toBe('POSSIBLY_CLOSED');
    expect(missingRow?.consecutive_misses).toBe(1);
  });
});
