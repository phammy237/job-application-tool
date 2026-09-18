import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import type { JobSource } from '@career-os/shared';
import * as syncSourceModule from './sync-source';
import { runDiscoverySync } from './run-sync';

function fakeSource(overrides: Partial<JobSource> & { id: string }): JobSource {
  return {
    companyName: 'Acme',
    sourceType: 'GREENHOUSE',
    sourceIdentifier: 'acme',
    careersUrl: null,
    enabled: true,
    crawlIntervalHours: 24,
    lastCrawledAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    etag: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const FAKE_SUPABASE = {} as CareerOsSupabaseClient;

describe('runDiscoverySync', () => {
  it('isolates one source throwing unexpectedly from the rest, and continues the loop', async () => {
    const sources = [
      fakeSource({ id: 'a', companyName: 'A' }),
      fakeSource({ id: 'b', companyName: 'B' }),
      fakeSource({ id: 'c', companyName: 'C' }),
    ];

    const spy = vi.spyOn(syncSourceModule, 'syncSource').mockImplementation(async (_s, source) => {
      if (source.id === 'b') throw new Error('boom');
      return {
        sourceId: source.id,
        companyName: source.companyName,
        provider: source.sourceType,
        outcome: 'SUCCESS',
        durationMs: 1,
        jobsFetched: 5,
        new: 5,
        updated: 0,
        unchanged: 0,
        possiblyClosed: 0,
        closed: 0,
        reopened: 0,
        rejected: 0,
      };
    });

    const summary = await runDiscoverySync(FAKE_SUPABASE, sources);

    expect(summary.sourcesAttempted).toBe(3);
    expect(summary.sourcesSucceeded).toBe(2);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.jobsFetched).toBe(10);
    expect(summary.results.find((r) => r.sourceId === 'b')?.error).toContain('boom');
    spy.mockRestore();
  });

  it('aggregates numeric counters across all sources', async () => {
    const sources = [fakeSource({ id: 'a' }), fakeSource({ id: 'b' })];
    const spy = vi.spyOn(syncSourceModule, 'syncSource').mockImplementation(async (_s, source) => ({
      sourceId: source.id,
      companyName: source.companyName,
      provider: source.sourceType,
      outcome: 'SUCCESS' as const,
      durationMs: 1,
      jobsFetched: 10,
      new: 3,
      updated: 2,
      unchanged: 5,
      possiblyClosed: 1,
      closed: 1,
      reopened: 0,
      rejected: 0,
    }));

    const summary = await runDiscoverySync(FAKE_SUPABASE, sources);
    expect(summary.new).toBe(6);
    expect(summary.updated).toBe(4);
    expect(summary.unchanged).toBe(10);
    expect(summary.possiblyClosed).toBe(2);
    expect(summary.closed).toBe(2);
    spy.mockRestore();
  });

  it('calls onSourceResult once per source, in order', async () => {
    const sources = [fakeSource({ id: 'a' }), fakeSource({ id: 'b' })];
    const spy = vi.spyOn(syncSourceModule, 'syncSource').mockImplementation(async (_s, source) => ({
      sourceId: source.id,
      companyName: source.companyName,
      provider: source.sourceType,
      outcome: 'SUCCESS' as const,
      durationMs: 1,
      jobsFetched: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      possiblyClosed: 0,
      closed: 0,
      reopened: 0,
      rejected: 0,
    }));

    const seen: string[] = [];
    await runDiscoverySync(FAKE_SUPABASE, sources, { onSourceResult: (r) => seen.push(r.sourceId) });
    expect(seen).toEqual(['a', 'b']);
    spy.mockRestore();
  });

  it('handles an empty source list', async () => {
    const summary = await runDiscoverySync(FAKE_SUPABASE, []);
    expect(summary).toMatchObject({ sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0 });
  });
});
