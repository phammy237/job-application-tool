import { describe, expect, it } from 'vitest';
import type { RawDiscoveredJob } from '@career-os/shared';
import { normalizeDiscoveredJob } from './normalize';

const RAW: RawDiscoveredJob = {
  sourceJobId: '123',
  companyName: 'Acme Corp',
  title: ' Backend Engineer ',
  locationText: 'San Francisco, CA',
  workplaceType: 'HYBRID',
  employmentType: 'Full-time',
  description: 'Build things.',
  responsibilities: null,
  qualifications: null,
  salaryMin: 120000,
  salaryMax: 160000,
  salaryCurrency: 'USD',
  applyUrl: 'https://boards.example.com/acme/jobs/123?utm_source=x',
  sourceUrl: 'https://boards.example.com/acme/jobs/123',
  postedAt: '2026-01-01T00:00:00.000Z',
  sourceUpdatedAt: '2026-01-02T00:00:00.000Z',
};

describe('normalizeDiscoveredJob', () => {
  it('derives normalizedTitle/normalizedLocation deterministically', async () => {
    const result = await normalizeDiscoveredJob(RAW);
    expect(result.normalizedTitle).toBe('backend engineer');
    expect(result.normalizedLocation).toBe('san francisco, ca');
  });

  it('derives city/state/country from an unambiguous "City, ST" location', async () => {
    const result = await normalizeDiscoveredJob(RAW);
    expect(result.city).toBe('San Francisco');
    expect(result.stateRegion).toBe('CA');
    expect(result.country).toBe('United States');
  });

  it('canonicalizes the apply URL (strips tracking query params)', async () => {
    const result = await normalizeDiscoveredJob(RAW);
    expect(result.canonicalApplyUrl).toBe('https://boards.example.com/acme/jobs/123');
  });

  it('computes a non-empty content hash and dedupe fingerprint', async () => {
    const result = await normalizeDiscoveredJob(RAW);
    expect(result.contentHash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(result.dedupeFingerprint).toBeTruthy();
  });

  it('produces the same content hash for two logically-identical raw jobs', async () => {
    const a = await normalizeDiscoveredJob(RAW);
    const b = await normalizeDiscoveredJob({ ...RAW, title: 'Backend Engineer' });
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('produces a different content hash when a meaningful field changes', async () => {
    const a = await normalizeDiscoveredJob(RAW);
    const b = await normalizeDiscoveredJob({ ...RAW, salaryMax: 170000 });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('never guesses city/state/country for a multi-location string', async () => {
    const result = await normalizeDiscoveredJob({
      ...RAW,
      locationText: 'Seattle, San Francisco, New York City',
    });
    expect(result.city).toBeNull();
    expect(result.stateRegion).toBeNull();
    expect(result.country).toBeNull();
  });

  it('leaves postedAt/sourceUpdatedAt null for an unparseable date, never guessed', async () => {
    const result = await normalizeDiscoveredJob({
      ...RAW,
      postedAt: 'not-a-date',
      sourceUpdatedAt: undefined,
    });
    expect(result.postedAt).toBeNull();
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it('passes through null optional fields as null, never fabricated', async () => {
    const result = await normalizeDiscoveredJob({
      sourceJobId: '456',
      companyName: 'Acme',
      title: 'Role',
      locationText: null,
      applyUrl: 'https://example.com/apply',
    });
    expect(result.workplaceType).toBeNull();
    expect(result.employmentType).toBeNull();
    expect(result.description).toBeNull();
    expect(result.salaryMin).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.postedAt).toBeNull();
  });
});
