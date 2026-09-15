import { isSafeExternalUrl } from '@career-os/shared';

/**
 * Phase 7G's one external research provider (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §2) — chosen
 * after inspecting this repo for any existing search/scraping infrastructure (none exists) and
 * evaluating the options the phase brief lists: Tavily is a plain HTTPS JSON API purpose-built for
 * LLM research pipelines, giving both discovery (`/search`, with title/url/snippet/optional
 * published date) and safe extraction (`/extract`, cleaned page text, no HTML/script/nav noise)
 * from one provider — no browser automation, no Docker, no anti-bot bypass, serverless-compatible
 * with a plain `fetch`. This is the *only* place in the codebase that talks to Tavily; every
 * caller goes through the two functions below, never a raw `fetch('https://api.tavily.com/...')`
 * scattered elsewhere (§36).
 *
 * `TAVILY_API_KEY` is read lazily (inside each function, not at module load) so this package
 * keeps importing cleanly in tooling/tests that never call it — same posture as
 * `claude/client.ts`'s lazy Anthropic client. Never logged, never included in an error message
 * (§78).
 */

const SEARCH_TIMEOUT_MS = 15_000;
const EXTRACT_TIMEOUT_MS = 20_000;
/** Defensive cap on the raw HTTP response body size this module will read, independent of
 * anything Tavily's own API contract promises — a compromised/misbehaving endpoint should never
 * be able to make this process buffer an unbounded response (§22's response-size-cap principle,
 * applied even though we are calling a trusted first-party API rather than an arbitrary URL). */
const MAX_RESPONSE_BYTES = 2_000_000;

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export interface TavilySearchResultItem {
  url: string;
  title: string;
  content: string;
  /** ISO date string when Tavily's own metadata exposes one — null otherwise, never fabricated
   * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §28: "If unknown: do not manufacture a date"). */
  publishedDate: string | null;
}

export type TavilySearchOutcome =
  | { status: 'ok'; results: TavilySearchResultItem[] }
  | { status: 'unavailable' }
  | { status: 'provider_error'; message: string };

async function fetchWithBoundedBody(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: 'ok'; body: unknown } | { status: 'error'; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return { status: 'error', message: 'response too large' };
    }
    if (!response.ok) {
      return { status: 'error', message: `HTTP ${response.status}` };
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return { status: 'error', message: 'response too large' };
    }
    return { status: 'ok', body: JSON.parse(text) as unknown };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'error', message: 'request timed out' };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'unknown fetch error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One bounded discovery call (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §18) — the caller
 * (`generate-company-research.ts`) issues at most `MAX_COMPANY_RESEARCH_QUERIES` of these, never
 * an unbounded/recursive search loop. Every returned URL is checked with `isSafeExternalUrl`
 * before being handed back — the provider's own response is untrusted data too (§77).
 */
export async function tavilySearch(
  query: string,
  options: { topic?: 'general' | 'news'; maxResults?: number } = {},
): Promise<TavilySearchOutcome> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { status: 'unavailable' };

  const result = await fetchWithBoundedBody(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        topic: options.topic ?? 'general',
        max_results: options.maxResults ?? 5,
        include_answer: false,
        include_raw_content: false,
      }),
    },
    SEARCH_TIMEOUT_MS,
  );
  if (result.status === 'error') {
    return { status: 'provider_error', message: result.message };
  }

  const body = result.body as { results?: unknown };
  if (!Array.isArray(body.results)) {
    return { status: 'provider_error', message: 'malformed search response' };
  }

  const results: TavilySearchResultItem[] = [];
  for (const raw of body.results) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url : null;
    if (!url || !isSafeExternalUrl(url)) continue;
    const title =
      typeof r.title === 'string' && r.title.trim().length > 0 ? r.title.trim() : url;
    const content = typeof r.content === 'string' ? r.content : '';
    const publishedDate =
      typeof r.published_date === 'string' && !Number.isNaN(Date.parse(r.published_date))
        ? new Date(r.published_date).toISOString()
        : null;
    results.push({ url, title, content, publishedDate });
  }

  return { status: 'ok', results };
}

export interface TavilyExtractResultItem {
  url: string;
  rawContent: string;
}

export type TavilyExtractOutcome =
  | { status: 'ok'; results: TavilyExtractResultItem[]; failedUrls: string[] }
  | { status: 'unavailable' }
  | { status: 'provider_error'; message: string };

/**
 * One bounded, batched extraction call for a caller-selected (already deduped/ranked/capped) list
 * of URLs (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §18) — never one call per URL. URLs that fail
 * extraction are reported in `failedUrls` rather than failing the whole batch (§39:
 * `source_extraction_failed` is a per-source degradation, not a hard pipeline stop as long as at
 * least one source extracted successfully — the caller decides that threshold).
 */
export async function tavilyExtract(urls: string[]): Promise<TavilyExtractOutcome> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { status: 'unavailable' };
  if (urls.length === 0) return { status: 'ok', results: [], failedUrls: [] };

  const safeUrls = urls.filter(isSafeExternalUrl);

  const result = await fetchWithBoundedBody(
    'https://api.tavily.com/extract',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ urls: safeUrls }),
    },
    EXTRACT_TIMEOUT_MS,
  );
  if (result.status === 'error') {
    return { status: 'provider_error', message: result.message };
  }

  const body = result.body as { results?: unknown; failed_results?: unknown };
  const results: TavilyExtractResultItem[] = [];
  if (Array.isArray(body.results)) {
    for (const raw of body.results) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const url = typeof r.url === 'string' ? r.url : null;
      const rawContent = typeof r.raw_content === 'string' ? r.raw_content : null;
      if (!url || !isSafeExternalUrl(url) || !rawContent) continue;
      results.push({ url, rawContent });
    }
  }

  const extractedUrls = new Set(results.map((r) => r.url));
  const failedUrls = safeUrls.filter((url) => !extractedUrls.has(url));

  return { status: 'ok', results, failedUrls };
}
