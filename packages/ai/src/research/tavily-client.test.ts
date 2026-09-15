import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTavilyConfigured, tavilyExtract, tavilySearch } from './tavily-client';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

const ORIGINAL_ENV = process.env.TAVILY_API_KEY;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  process.env.TAVILY_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.TAVILY_API_KEY = ORIGINAL_ENV;
});

describe('isTavilyConfigured', () => {
  it('is false when no key is set', () => {
    delete process.env.TAVILY_API_KEY;
    expect(isTavilyConfigured()).toBe(false);
  });
  it('is true when a non-blank key is set', () => {
    process.env.TAVILY_API_KEY = 'abc';
    expect(isTavilyConfigured()).toBe(true);
  });
  it('is false for a blank/whitespace key', () => {
    process.env.TAVILY_API_KEY = '   ';
    expect(isTavilyConfigured()).toBe(false);
  });
});

describe('tavilySearch', () => {
  it('returns unavailable with no network call when no API key is configured', async () => {
    delete process.env.TAVILY_API_KEY;
    const result = await tavilySearch('Acme official');
    expect(result).toEqual({ status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns ok with mapped, safety-filtered results', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        results: [
          {
            url: 'https://acme.com/news',
            title: 'Acme News',
            content: 'Acme launched X.',
            published_date: '2026-09-10',
          },
          { url: 'http://169.254.169.254/steal-creds', title: 'evil', content: 'x' }, // filtered: unsafe URL
          { url: 'https://acme.com/no-title', title: '', content: 'no title here' }, // title falls back to url
        ],
      }),
    );
    const result = await tavilySearch('Acme official');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      url: 'https://acme.com/news',
      title: 'Acme News',
      content: 'Acme launched X.',
      publishedDate: new Date('2026-09-10').toISOString(),
    });
    expect(result.results[1]?.title).toBe('https://acme.com/no-title');
  });

  it('never manufactures a publishedDate when the provider omits one', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        results: [{ url: 'https://acme.com/x', title: 'X', content: 'y' }],
      }),
    );
    const result = await tavilySearch('Acme official');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.results[0]?.publishedDate).toBeNull();
    }
  });

  it('returns provider_error on a non-ok HTTP response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({}, false, 500));
    const result = await tavilySearch('Acme official');
    expect(result).toEqual({ status: 'provider_error', message: 'HTTP 500' });
  });

  it('returns provider_error on a malformed response shape', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ notResults: [] }));
    const result = await tavilySearch('Acme official');
    expect(result).toEqual({
      status: 'provider_error',
      message: 'malformed search response',
    });
  });

  it('returns provider_error when fetch itself throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    const result = await tavilySearch('Acme official');
    expect(result).toEqual({ status: 'provider_error', message: 'network down' });
  });

  it('never includes the API key in any returned value', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ results: [] }));
    const result = await tavilySearch('Acme official');
    expect(JSON.stringify(result)).not.toContain('test-key');
  });
});

describe('tavilyExtract', () => {
  it('returns unavailable with no network call when no API key is configured', async () => {
    delete process.env.TAVILY_API_KEY;
    const result = await tavilyExtract(['https://acme.com/x']);
    expect(result).toEqual({ status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns ok with no network call for an empty URL list', async () => {
    const result = await tavilyExtract([]);
    expect(result).toEqual({ status: 'ok', results: [], failedUrls: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports per-URL extraction failure without failing the whole batch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        results: [{ url: 'https://acme.com/a', raw_content: 'Extracted text for A.' }],
        failed_results: [{ url: 'https://acme.com/b', error: 'timeout' }],
      }),
    );
    const result = await tavilyExtract(['https://acme.com/a', 'https://acme.com/b']);
    expect(result).toEqual({
      status: 'ok',
      results: [{ url: 'https://acme.com/a', rawContent: 'Extracted text for A.' }],
      failedUrls: ['https://acme.com/b'],
    });
  });

  it('filters out an unsafe URL before ever sending it to the provider', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ results: [] }));
    await tavilyExtract(['https://acme.com/a', 'http://127.0.0.1/steal']);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    expect(sentBody.urls).toEqual(['https://acme.com/a']);
  });

  it('returns provider_error on a non-ok HTTP response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({}, false, 503));
    const result = await tavilyExtract(['https://acme.com/a']);
    expect(result).toEqual({ status: 'provider_error', message: 'HTTP 503' });
  });
});
