import { afterEach, describe, expect, it, vi } from 'vitest';
import { leverAdapter } from './lever';
import sample from './__fixtures__/lever-sample.json';
import malformed from './__fixtures__/lever-malformed.json';
import invalidResponse from './__fixtures__/lever-invalid-response.json';

const SOURCE = { sourceType: 'LEVER' as const, sourceIdentifier: 'palantir', companyName: 'Palantir' };

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

describe('leverAdapter', () => {
  it('fetches the correct postings URL', async () => {
    mockFetchOnce({ ok: true, json: [] });
    await leverAdapter.fetchJobs(SOURCE);
    expect(fetch).toHaveBeenCalledWith('https://api.lever.co/v0/postings/palantir?mode=json');
  });

  it('normalizes a normal posting: id, title, location, workplaceType, timestamps', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await leverAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    const first = result.jobs.find((j) => j.sourceJobId === 'ac978161-6f46-4f6b-ad9e-a258e642751c');
    expect(first?.title).toBe('Administrative Business Partner');
    expect(first?.companyName).toBe('Palantir');
    expect(first?.locationText).toBe('London, United Kingdom');
    expect(first?.workplaceType).toBe('HYBRID');
    expect(first?.employmentType).toBe('Full-time');
    expect(first?.applyUrl).toBe(
      'https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply',
    );
    expect(first?.sourceUrl).toBe(
      'https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c',
    );
    expect(first?.postedAt).toBe(new Date(1711403416463).toISOString());
  });

  it('maps workplaceType values correctly (on-site -> ONSITE, remote -> REMOTE)', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await leverAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    expect(result.jobs.find((j) => j.sourceJobId === 'bb978161-6f46-4f6b-ad9e-a258e642752d')?.workplaceType).toBe(
      'ONSITE',
    );
    expect(result.jobs.find((j) => j.sourceJobId === 'cc978161-6f46-4f6b-ad9e-a258e642753e')?.workplaceType).toBe(
      'REMOTE',
    );
  });

  it('parses salaryRange when present', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await leverAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const withSalary = result.jobs.find((j) => j.sourceJobId === 'bb978161-6f46-4f6b-ad9e-a258e642752d');
    expect(withSalary?.salaryMin).toBe(130000);
    expect(withSalary?.salaryMax).toBe(190000);
    expect(withSalary?.salaryCurrency).toBe('USD');
  });

  it('leaves missing optional fields (location, salary, description) as null', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await leverAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const noLocation = result.jobs.find((j) => j.sourceJobId === 'cc978161-6f46-4f6b-ad9e-a258e642753e');
    expect(noLocation?.locationText).toBeNull();
    expect(noLocation?.salaryMin).toBeNull();
    expect(noLocation?.description).toBeNull();
  });

  it('rejects malformed individual postings without failing the whole crawl', async () => {
    mockFetchOnce({ ok: true, json: malformed });
    const result = await leverAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sourceJobId).toBe('valid-1');
    expect(result.rejected).toHaveLength(4);
  });

  it('treats a non-array top-level response as FAILURE', async () => {
    mockFetchOnce({ ok: true, json: invalidResponse });
    const result = await leverAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });

  it('treats a non-2xx HTTP response as FAILURE', async () => {
    mockFetchOnce({ ok: false, status: 404, json: { ok: false } });
    const result = await leverAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
    if (result.status !== 'FAILURE') return;
    expect(result.error).toContain('404');
  });

  it('treats a network error as FAILURE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const result = await leverAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });
});
