import { afterEach, describe, expect, it, vi } from 'vitest';
import { ashbyAdapter } from './ashby';
import sample from './__fixtures__/ashby-sample.json';
import malformed from './__fixtures__/ashby-malformed.json';
import invalidResponse from './__fixtures__/ashby-invalid-response.json';

const SOURCE = { sourceType: 'ASHBY' as const, sourceIdentifier: 'ramp', companyName: 'Ramp' };

function mockFetchOnce(options: { ok: boolean; status?: number; json?: unknown; jsonThrows?: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: options.ok,
      status: options.status ?? (options.ok ? 200 : 500),
      json: options.jsonThrows
        ? vi.fn().mockRejectedValue(new Error('bad json'))
        : vi.fn().mockResolvedValue(options.json),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ashbyAdapter', () => {
  it('fetches the correct job-board URL with compensation included', async () => {
    mockFetchOnce({ ok: true, json: { jobs: [] } });
    await ashbyAdapter.fetchJobs(SOURCE);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true',
    );
  });

  it('normalizes a normal posting: id, title, location, workplaceType, description, timestamps', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    const first = result.jobs.find((j) => j.sourceJobId === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    expect(first?.title).toBe(' Security Engineer, Cloud');
    expect(first?.companyName).toBe('Ramp');
    expect(first?.locationText).toBe('New York, NY (HQ)');
    expect(first?.workplaceType).toBe('HYBRID');
    expect(first?.employmentType).toBe('FullTime');
    expect(first?.applyUrl).toBe(
      'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application',
    );
    expect(first?.sourceUrl).toBe('https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    expect(first?.postedAt).toBe('2026-04-07T17:12:35.753+00:00');
  });

  it('parses a Salary compensation component when present', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const withSalary = result.jobs.find((j) => j.sourceJobId === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    expect(withSalary?.salaryMin).toBe(211400);
    expect(withSalary?.salaryMax).toBe(290600);
    expect(withSalary?.salaryCurrency).toBe('USD');
  });

  it('leaves missing compensation as null, never fabricated', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const noComp = result.jobs.find((j) => j.sourceJobId === '44413f8d-26bf-4bbc-8ade-eb309a0e2246');
    expect(noComp?.salaryMin).toBeNull();
    expect(noComp?.salaryMax).toBeNull();
  });

  it('silently excludes unlisted postings (not a rejection, not a job)', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    expect(result.jobs.find((j) => j.sourceJobId === '54413f8d-26bf-4bbc-8ade-eb309a0e2247')).toBeUndefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects malformed individual postings without failing the whole crawl', async () => {
    mockFetchOnce({ ok: true, json: malformed });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sourceJobId).toBe('valid-1');
    expect(result.rejected).toHaveLength(4);
  });

  it('treats an invalid top-level response (no jobs array) as FAILURE', async () => {
    mockFetchOnce({ ok: true, json: invalidResponse });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });

  it('treats a non-2xx HTTP response as FAILURE', async () => {
    mockFetchOnce({ ok: false, status: 500, json: {} });
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });

  it('treats a network error as FAILURE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const result = await ashbyAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });
});
