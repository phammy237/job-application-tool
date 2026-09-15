import { describe, expect, it } from 'vitest';
import type { NormalizedDiscoveredJob } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';
import { reconcileMissingJobsForSource, upsertDiscoveredJobsForSource } from './job-catalog';

/**
 * A minimal in-memory fake of the exact PostgREST call shapes `job-catalog.ts` actually issues
 * (select/eq/in, upsert with onConflict, update/in) — thenable, like supabase-js's own query
 * builder, so `await supabase.from(...).select(...).eq(...)` resolves the same way. This lets the
 * docs/JOB_DISCOVERY.md §24 lifecycle scenarios (A-I, this file covers the ones that are
 * query-layer behavior rather than adapter/orchestrator behavior) run deterministically and fast
 * against real upsert/reconcile logic, without a live database dependency. Real database-level
 * guarantees (uniqueness, RLS, CHECK constraints) are separately covered by the pgTAP suite
 * (supabase/tests/database/) and a live orchestrator run — see docs/JOB_DISCOVERY.md.
 */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}

class FakeStore {
  rows: FakeRow[] = [];
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

  constructor(private readonly store: FakeStore) {}

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

  private matches(row: FakeRow): boolean {
    return this.filters.every(([kind, col, value]) => {
      if (kind === 'eq') return row[col] === value;
      return (value as unknown[]).includes(row[col]);
    });
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
      const matched = this.store.rows.filter((row) => this.matches(row));
      const data = matched.map((row) => {
        const picked: Record<string, unknown> = {};
        for (const col of this.selectCols ?? []) picked[col] = row[col];
        return picked;
      });
      return { data, error: null };
    }

    if (this.op === 'update') {
      const matched = this.store.rows.filter((row) => this.matches(row));
      for (const row of matched) Object.assign(row, this.payload as Record<string, unknown>);
      return { data: null, error: null };
    }

    if (this.op === 'upsert') {
      for (const incoming of this.payload as Record<string, unknown>[]) {
        const existingIndex = this.store.rows.findIndex((row) =>
          this.upsertOnConflict.every((col) => row[col] === incoming[col]),
        );
        if (existingIndex >= 0) {
          const existing = this.store.rows[existingIndex] as FakeRow;
          this.store.rows[existingIndex] = { ...existing, ...incoming, id: existing.id };
        } else {
          this.store.rows.push({ id: this.store.genId(), ...incoming });
        }
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }
}

function fakeSupabase(store: FakeStore): CareerOsSupabaseClient {
  return { from: () => new FakeQuery(store) } as unknown as CareerOsSupabaseClient;
}

const SOURCE_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

function job(overrides: Partial<NormalizedDiscoveredJob> & { sourceJobId: string }): NormalizedDiscoveredJob {
  return {
    companyName: 'Acme Corp',
    title: 'Backend Engineer',
    normalizedTitle: 'backend engineer',
    locationText: 'San Francisco, CA',
    normalizedLocation: 'san francisco, ca',
    city: 'San Francisco',
    stateRegion: 'CA',
    country: 'United States',
    workplaceType: 'HYBRID',
    employmentType: 'Full-time',
    description: 'Build things.',
    responsibilities: null,
    qualifications: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    applyUrl: 'https://example.com/apply/1',
    sourceUrl: null,
    canonicalApplyUrl: 'https://example.com/apply/1',
    dedupeFingerprint: 'acme corp|backend engineer|san francisco, ca|https://example.com/apply/1',
    postedAt: null,
    sourceUpdatedAt: null,
    contentHash: 'v1:hash1',
    ...overrides,
  };
}

describe('upsertDiscoveredJobsForSource', () => {
  it('scenario A: first crawl creates 3 ACTIVE rows with first_seen == last_seen and misses 0', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    const now = new Date('2026-01-01T00:00:00.000Z');

    const jobs = [
      job({ sourceJobId: '1' }),
      job({ sourceJobId: '2' }),
      job({ sourceJobId: '3' }),
    ];
    const summary = await upsertDiscoveredJobsForSource(supabase, SOURCE_ID, jobs, now);

    expect(summary).toEqual({ new: 3, updated: 0, unchanged: 0, reopened: 0 });
    expect(store.rows).toHaveLength(3);
    for (const row of store.rows) {
      expect(row.status).toBe('ACTIVE');
      expect(row.first_seen_at).toBe(row.last_seen_at);
      expect(row.consecutive_misses).toBe(0);
      expect(row.closed_at).toBeNull();
    }
  });

  it('scenario B: an identical second crawl updates last_seen only, leaves content_updated_at and first_seen_at untouched, no duplicates', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    const firstCrawl = new Date('2026-01-01T00:00:00.000Z');
    const secondCrawl = new Date('2026-01-02T00:00:00.000Z');

    const jobs = [job({ sourceJobId: '1' }), job({ sourceJobId: '2' }), job({ sourceJobId: '3' })];
    await upsertDiscoveredJobsForSource(supabase, SOURCE_ID, jobs, firstCrawl);
    const idsAfterFirst = store.rows.map((r) => r.id).sort();
    const contentUpdatedAfterFirst = store.rows.map((r) => r.content_updated_at);
    const firstSeenAfterFirst = store.rows.map((r) => r.first_seen_at);

    const summary = await upsertDiscoveredJobsForSource(supabase, SOURCE_ID, jobs, secondCrawl);

    expect(summary).toEqual({ new: 0, updated: 0, unchanged: 3, reopened: 0 });
    expect(store.rows).toHaveLength(3);
    expect(store.rows.map((r) => r.id).sort()).toEqual(idsAfterFirst);
    expect(store.rows.map((r) => r.content_updated_at)).toEqual(contentUpdatedAfterFirst);
    expect(store.rows.map((r) => r.first_seen_at)).toEqual(firstSeenAfterFirst);
    for (const row of store.rows) {
      expect(row.last_seen_at).toBe(secondCrawl.toISOString());
    }
  });

  it('scenario C: a changed job keeps its row id, changes content_hash, advances content_updated_at, preserves first_seen_at', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    const firstCrawl = new Date('2026-01-01T00:00:00.000Z');
    const secondCrawl = new Date('2026-01-02T00:00:00.000Z');

    await upsertDiscoveredJobsForSource(supabase, SOURCE_ID, [job({ sourceJobId: '1' })], firstCrawl);
    const originalId = store.rows[0]?.id;
    const originalFirstSeen = store.rows[0]?.first_seen_at;

    const summary = await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1', title: 'Staff Backend Engineer', contentHash: 'v1:hash2' })],
      secondCrawl,
    );

    expect(summary).toEqual({ new: 0, updated: 1, unchanged: 0, reopened: 0 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.id).toBe(originalId);
    expect(store.rows[0]?.content_hash).toBe('v1:hash2');
    expect(store.rows[0]?.title).toBe('Staff Backend Engineer');
    expect(store.rows[0]?.content_updated_at).toBe(secondCrawl.toISOString());
    expect(store.rows[0]?.first_seen_at).toBe(originalFirstSeen);
  });

  it('scenario G: a closed job reappearing reopens the same row (ACTIVE, misses 0, closed_at null)', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const originalId = store.rows[0]?.id;

    // Simulate the job having been previously closed by reconciliation.
    store.rows[0]!.status = 'CLOSED';
    store.rows[0]!.consecutive_misses = 2;
    store.rows[0]!.closed_at = '2026-01-05T00:00:00.000Z';

    const summary = await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' })],
      new Date('2026-01-10T00:00:00.000Z'),
    );

    expect(summary).toEqual({ new: 0, updated: 0, unchanged: 0, reopened: 1 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.id).toBe(originalId);
    expect(store.rows[0]?.status).toBe('ACTIVE');
    expect(store.rows[0]?.consecutive_misses).toBe(0);
    expect(store.rows[0]?.closed_at).toBeNull();
  });

  it('scenario H: a duplicate source_job_id within one response collapses to one row', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);

    const summary = await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1', title: 'First' }), job({ sourceJobId: '1', title: 'Second' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(store.rows).toHaveLength(1);
    expect(summary.new).toBe(1);
    // Deterministic: the first occurrence wins.
    expect(store.rows[0]?.title).toBe('First');
  });

  it('is a no-op for an empty batch', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    const summary = await upsertDiscoveredJobsForSource(supabase, SOURCE_ID, []);
    expect(summary).toEqual({ new: 0, updated: 0, unchanged: 0, reopened: 0 });
    expect(store.rows).toHaveLength(0);
  });
});

describe('reconcileMissingJobsForSource', () => {
  it('scenario D: a job missing once becomes POSSIBLY_CLOSED with misses = 1', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' }), job({ sourceJobId: '2' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const summary = await reconcileMissingJobsForSource(
      supabase,
      SOURCE_ID,
      ['1'], // job "2" was not seen this crawl
      new Date('2026-01-02T00:00:00.000Z'),
    );

    expect(summary).toEqual({ possiblyClosed: 1, closed: 0 });
    const row1 = store.rows.find((r) => r.source_job_id === '1');
    const row2 = store.rows.find((r) => r.source_job_id === '2');
    expect(row1?.status).toBe('ACTIVE');
    expect(row2?.status).toBe('POSSIBLY_CLOSED');
    expect(row2?.consecutive_misses).toBe(1);
    expect(row2?.closed_at).toBeNull();
  });

  it('scenario E: a job missing a second consecutive successful crawl becomes CLOSED with closed_at set', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await reconcileMissingJobsForSource(supabase, SOURCE_ID, [], new Date('2026-01-02T00:00:00.000Z'));
    expect(store.rows[0]?.status).toBe('POSSIBLY_CLOSED');

    const summary = await reconcileMissingJobsForSource(
      supabase,
      SOURCE_ID,
      [],
      new Date('2026-01-03T00:00:00.000Z'),
    );

    expect(summary).toEqual({ possiblyClosed: 0, closed: 1 });
    expect(store.rows[0]?.status).toBe('CLOSED');
    expect(store.rows[0]?.consecutive_misses).toBe(2);
    expect(store.rows[0]?.closed_at).toBe('2026-01-03T00:00:00.000Z');
  });

  it('never touches an already-CLOSED row (no further miss accumulation)', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await reconcileMissingJobsForSource(supabase, SOURCE_ID, [], new Date('2026-01-02T00:00:00.000Z'));
    await reconcileMissingJobsForSource(supabase, SOURCE_ID, [], new Date('2026-01-03T00:00:00.000Z'));
    expect(store.rows[0]?.status).toBe('CLOSED');
    const closedAt = store.rows[0]?.closed_at;

    const summary = await reconcileMissingJobsForSource(
      supabase,
      SOURCE_ID,
      [],
      new Date('2026-01-04T00:00:00.000Z'),
    );

    expect(summary).toEqual({ possiblyClosed: 0, closed: 0 });
    expect(store.rows[0]?.status).toBe('CLOSED');
    expect(store.rows[0]?.consecutive_misses).toBe(2);
    expect(store.rows[0]?.closed_at).toBe(closedAt);
  });

  it('is a no-op when nothing is missing', async () => {
    const store = new FakeStore();
    const supabase = fakeSupabase(store);
    await upsertDiscoveredJobsForSource(
      supabase,
      SOURCE_ID,
      [job({ sourceJobId: '1' })],
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const summary = await reconcileMissingJobsForSource(supabase, SOURCE_ID, ['1']);
    expect(summary).toEqual({ possiblyClosed: 0, closed: 0 });
    expect(store.rows[0]?.status).toBe('ACTIVE');
  });
});
