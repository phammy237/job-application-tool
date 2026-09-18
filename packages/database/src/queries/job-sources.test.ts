import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  getJobSource,
  listEnabledJobSourcesDueForCrawl,
  recordJobSourceCrawlFailure,
  recordJobSourceCrawlSuccess,
  upsertJobSource,
} from './job-sources';

const SOURCE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const BASE_ROW = {
  id: SOURCE_ID,
  company_name: 'Acme',
  source_type: 'GREENHOUSE',
  source_identifier: 'acme',
  careers_url: 'https://acme.example.com/careers',
  enabled: true,
  crawl_interval_hours: 24,
  last_crawled_at: null as string | null,
  last_success_at: null as string | null,
  last_error_at: null as string | null,
  last_error: null as string | null,
  consecutive_failures: 0,
  etag: null as string | null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** Same shape/conventions as this package's other query tests: a single reused chain object
 * whose terminal methods (maybeSingle/single) resolve explicitly, and whose `.then` resolves a
 * bare `select`/`update` chain based on whichever was invoked last. */
function fakeSupabase(overrides: {
  selectResult?: { data: unknown; error: null };
  singleResult?: { data: unknown; error: null };
  updateResult?: { data: unknown; error: null };
}) {
  let lastOp: 'select' | 'update' | null = null;
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => {
    lastOp = 'select';
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.upsert = vi.fn(() => chain);
  chain.update = vi.fn(() => {
    lastOp = 'update';
    return chain;
  });
  chain.maybeSingle = vi
    .fn()
    .mockResolvedValue(overrides.selectResult ?? { data: null, error: null });
  chain.single = vi.fn().mockResolvedValue(overrides.singleResult ?? { data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => {
    if (lastOp === 'update') return resolve(overrides.updateResult ?? { data: null, error: null });
    return resolve(overrides.selectResult ?? { data: [], error: null });
  };
  return { from: vi.fn(() => chain), _chain: chain } as unknown as CareerOsSupabaseClient & {
    _chain: Record<string, unknown>;
  };
}

describe('getJobSource', () => {
  it('parses a row into a JobSource', async () => {
    const supabase = fakeSupabase({ selectResult: { data: BASE_ROW, error: null } });
    const result = await getJobSource(supabase, SOURCE_ID);
    expect(result?.id).toBe(SOURCE_ID);
    expect(result?.sourceType).toBe('GREENHOUSE');
  });

  it('returns null when not found', async () => {
    const supabase = fakeSupabase({ selectResult: { data: null, error: null } });
    expect(await getJobSource(supabase, SOURCE_ID)).toBeNull();
  });
});

describe('listEnabledJobSourcesDueForCrawl', () => {
  it('includes a source that has never been crawled', async () => {
    const supabase = fakeSupabase({ selectResult: { data: [BASE_ROW], error: null } });
    const result = await listEnabledJobSourcesDueForCrawl(supabase);
    expect(result).toHaveLength(1);
  });

  it('excludes a source crawled more recently than its interval', async () => {
    const recentlyCrawled = { ...BASE_ROW, last_crawled_at: '2026-01-02T00:00:00.000Z' };
    const supabase = fakeSupabase({ selectResult: { data: [recentlyCrawled], error: null } });
    const result = await listEnabledJobSourcesDueForCrawl(supabase, {
      now: new Date('2026-01-02T01:00:00.000Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('includes a source whose interval has elapsed', async () => {
    const staleCrawl = { ...BASE_ROW, last_crawled_at: '2026-01-01T00:00:00.000Z' };
    const supabase = fakeSupabase({ selectResult: { data: [staleCrawl], error: null } });
    const result = await listEnabledJobSourcesDueForCrawl(supabase, {
      now: new Date('2026-01-02T01:00:00.000Z'),
    });
    expect(result).toHaveLength(1);
  });
});

describe('upsertJobSource', () => {
  it('only includes explicitly-provided optional fields in the payload', async () => {
    const supabase = fakeSupabase({ singleResult: { data: BASE_ROW, error: null } });
    await upsertJobSource(supabase, {
      companyName: 'Acme',
      sourceType: 'GREENHOUSE',
      sourceIdentifier: 'acme',
    });
    const chain = (supabase as unknown as { _chain: { upsert: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.upsert.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('enabled');
    expect(payload).not.toHaveProperty('crawl_interval_hours');
    expect(payload).not.toHaveProperty('careers_url');
  });

  it('includes optional fields that were explicitly provided', async () => {
    const supabase = fakeSupabase({ singleResult: { data: BASE_ROW, error: null } });
    await upsertJobSource(supabase, {
      companyName: 'Acme',
      sourceType: 'GREENHOUSE',
      sourceIdentifier: 'acme',
      enabled: false,
      crawlIntervalHours: 12,
    });
    const chain = (supabase as unknown as { _chain: { upsert: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.upsert.mock.calls[0] as [Record<string, unknown>];
    expect(payload.enabled).toBe(false);
    expect(payload.crawl_interval_hours).toBe(12);
  });
});

describe('recordJobSourceCrawlSuccess / recordJobSourceCrawlFailure', () => {
  it('resets consecutive_failures and last_error on success', async () => {
    const supabase = fakeSupabase({ updateResult: { data: null, error: null } });
    await recordJobSourceCrawlSuccess(supabase, SOURCE_ID, new Date('2026-01-01T00:00:00.000Z'));
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload.consecutive_failures).toBe(0);
    expect(payload.last_error).toBeNull();
  });

  it('bounds a long error message before writing it', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: BASE_ROW, error: null },
      updateResult: { data: null, error: null },
    });
    const longMessage = 'x'.repeat(5000);
    await recordJobSourceCrawlFailure(
      supabase,
      SOURCE_ID,
      longMessage,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect((payload.last_error as string).length).toBeLessThanOrEqual(2000);
  });

  it('increments consecutive_failures from the current row value', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: { ...BASE_ROW, consecutive_failures: 2 }, error: null },
      updateResult: { data: null, error: null },
    });
    await recordJobSourceCrawlFailure(
      supabase,
      SOURCE_ID,
      'boom',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload.consecutive_failures).toBe(3);
  });
});
