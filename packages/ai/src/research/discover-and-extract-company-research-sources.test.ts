import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTavilyConfigured: vi.fn(),
  tavilySearch: vi.fn(),
  tavilyExtract: vi.fn(),
}));

vi.mock('./tavily-client', () => ({
  isTavilyConfigured: mocks.isTavilyConfigured,
  tavilySearch: mocks.tavilySearch,
  tavilyExtract: mocks.tavilyExtract,
}));

const { discoverAndExtractCompanyResearchSources } =
  await import('./discover-and-extract-company-research-sources');

function searchResult(
  url: string,
  title = 'Title',
  content = 'Snippet text',
  publishedDate: string | null = null,
) {
  return { url, title, content, publishedDate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTavilyConfigured.mockReturnValue(true);
  mocks.tavilySearch.mockResolvedValue({ status: 'ok', results: [] });
  mocks.tavilyExtract.mockResolvedValue({ status: 'ok', results: [], failedUrls: [] });
});

describe('discoverAndExtractCompanyResearchSources', () => {
  it('returns research_provider_unavailable with no search calls when Tavily is not configured', async () => {
    mocks.isTavilyConfigured.mockReturnValue(false);
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result).toEqual({ status: 'research_provider_unavailable' });
    expect(mocks.tavilySearch).not.toHaveBeenCalled();
  });

  it('issues at most the documented number of search queries', async () => {
    await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: ['topic'],
    });
    expect(mocks.tavilySearch.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('returns no_useful_sources when search finds nothing at all', async () => {
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result).toEqual({ status: 'no_useful_sources' });
    expect(mocks.tavilyExtract).not.toHaveBeenCalled();
  });

  it('returns provider_error only when every single search call fails', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'provider_error',
      message: 'timeout',
    });
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result).toEqual({ status: 'provider_error', message: 'timeout' });
  });

  it('excludes job-board/ATS domains from becoming research sources', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        searchResult('https://boards.greenhouse.io/acme/jobs/1', 'Job posting'),
        searchResult('https://boards.greenhouse.io/acme/jobs/1', 'Job posting'),
      ],
    });
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result).toEqual({ status: 'no_useful_sources' });
  });

  it('extracts full text for selected sources and falls back to the search snippet on a per-source extraction failure', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        searchResult('https://acme.com/a', 'A', 'Snippet A'),
        searchResult('https://acme.com/b', 'B', 'Snippet B'),
      ],
    });
    mocks.tavilyExtract.mockResolvedValue({
      status: 'ok',
      results: [{ url: 'https://acme.com/a', rawContent: 'Full extracted text for A.' }],
      failedUrls: ['https://acme.com/b'],
    });

    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const a = result.sources.find((s) => s.url === 'https://acme.com/a');
    const b = result.sources.find((s) => s.url === 'https://acme.com/b');
    expect(a?.text).toBe('Full extracted text for A.');
    expect(b?.text).toBe('Snippet B'); // fell back to the snippet, not dropped.
  });

  it('degrades to search snippets for every source when the whole extract call fails, rather than failing the pipeline', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: [searchResult('https://acme.com/a', 'A', 'Snippet A')],
    });
    mocks.tavilyExtract.mockResolvedValue({ status: 'provider_error', message: 'down' });

    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sources[0]?.text).toBe('Snippet A');
    }
  });

  it('deduplicates the same URL discovered by multiple query templates', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: [searchResult('https://acme.com/a', 'A', 'Snippet A')],
    });
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sources).toHaveLength(1);
    }
  });

  it('assigns each source a stable, server-generated uuid and a content hash', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: [searchResult('https://acme.com/a', 'A', 'Snippet A')],
    });
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sources[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('bounds the total number of selected sources across many discovered candidates', async () => {
    mocks.tavilySearch.mockResolvedValue({
      status: 'ok',
      results: Array.from({ length: 20 }, (_, i) =>
        searchResult(`https://site${i}.example/page`, `T${i}`),
      ),
    });
    const result = await discoverAndExtractCompanyResearchSources({
      companyName: 'Acme',
      roleTitle: 'PM',
      topRequirementTopics: [],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sources.length).toBeLessThanOrEqual(12);
    }
  });
});
