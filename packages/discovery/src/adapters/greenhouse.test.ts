import { afterEach, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter } from './greenhouse';
import sample from './__fixtures__/greenhouse-sample.json';
import malformed from './__fixtures__/greenhouse-malformed.json';
import invalidResponse from './__fixtures__/greenhouse-invalid-response.json';

const SOURCE = { sourceType: 'GREENHOUSE' as const, sourceIdentifier: 'stripe', companyName: 'Stripe' };

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

describe('greenhouseAdapter', () => {
  it('fetches the correct board URL', async () => {
    mockFetchOnce({ ok: true, json: { jobs: [], meta: { total: 0 } } });
    await greenhouseAdapter.fetchJobs(SOURCE);
    expect(fetch).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true',
    );
  });

  it('normalizes a normal posting: id, title, location, decoded HTML content, timestamps', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    const first = result.jobs.find((j) => j.sourceJobId === '8172510');
    expect(first).toBeDefined();
    expect(first?.title).toBe('Abuse Investigator');
    expect(first?.companyName).toBe('Stripe');
    expect(first?.locationText).toBe('Seattle, San Francisco, New York City');
    expect(first?.applyUrl).toBe('https://stripe.com/jobs/search?gh_jid=8172510');
    expect(first?.description).toContain('<h2><strong>About the team</strong></h2>');
    expect(first?.description).not.toContain('&lt;');
    expect(first?.postedAt).toBe('2026-09-09T10:50:29-04:00');
    expect(first?.sourceUpdatedAt).toBe('2026-09-10T13:11:58-04:00');
  });

  it('preserves a title with surrounding whitespace verbatim (normalization happens later)', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const second = result.jobs.find((j) => j.sourceJobId === '8200001');
    expect(second?.title).toBe(' Software Engineer, Backend ');
  });

  it('leaves nullable/missing optional fields as null, never fabricated', async () => {
    mockFetchOnce({ ok: true, json: sample });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    if (result.status !== 'SUCCESS') throw new Error('expected SUCCESS');
    const third = result.jobs.find((j) => j.sourceJobId === '8200002');
    expect(third?.locationText).toBeNull();
    expect(third?.description).toBeNull();
    expect(third?.postedAt).toBeNull();
    expect(third?.sourceUpdatedAt).toBeNull();
    expect(third?.salaryMin).toBeNull();
    expect(third?.workplaceType).toBeNull();
  });

  it('rejects malformed individual postings without failing the whole crawl', async () => {
    mockFetchOnce({ ok: true, json: malformed });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sourceJobId).toBe('9000001');
    expect(result.rejected).toHaveLength(4);
  });

  it('treats an invalid top-level response (no jobs array) as FAILURE, not zero jobs', async () => {
    mockFetchOnce({ ok: true, json: invalidResponse });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
    if (result.status !== 'FAILURE') return;
    expect(result.error).toBeTruthy();
  });

  it('treats a non-2xx HTTP response as FAILURE', async () => {
    mockFetchOnce({ ok: false, status: 404, json: { error: 'not found' } });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
    if (result.status !== 'FAILURE') return;
    expect(result.error).toContain('404');
  });

  it('treats a network error as FAILURE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });

  it('treats invalid JSON as FAILURE', async () => {
    mockFetchOnce({ ok: true, json: null, jsonThrows: true });
    const result = await greenhouseAdapter.fetchJobs(SOURCE);
    expect(result.status).toBe('FAILURE');
  });
});
