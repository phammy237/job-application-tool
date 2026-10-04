import { AuthError, GithubApiError, NotFoundError, RateLimitError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GithubClientOptions {
  token?: string | null;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  baseUrl?: string;
  maxAttempts?: number;
  maxPages?: number;
  baseBackoffMs?: number;
  /** Retry-After values above this are surfaced as a RateLimitError instead of slept on. */
  maxInlineWaitSeconds?: number;
}

export interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  default_branch: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  created_at: string | null;
  pushed_at: string | null;
  owner: { login: string };
}

export interface RepoDetailResult {
  notModified: boolean;
  repo: RawRepo | null;
  etag: string | null;
}

export interface ReadmeResult {
  text: string;
  sha: string;
}

export interface MergedPr {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
}

export const README_MAX_CHARS = 6000;
export const MAX_PR_SAMPLE = 30;
export const MAX_CONTRIBUTORS = 10;

const API_ORIGIN = 'https://api.github.com';
const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Result {
  status: number;
  data: unknown;
  headers: Headers;
}

function parseLink(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) out[m[2]!] = m[1]!;
  }
  return out;
}

/**
 * Minimal GitHub REST client. The token is only ever placed in the Authorization header; it is
 * never logged, serialized (toJSON omits it), or included in any error message.
 */
export class GithubClient {
  private readonly token: string | null;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly maxPages: number;
  private readonly baseBackoffMs: number;
  private readonly maxInlineWaitSeconds: number;

  constructor(options: GithubClientOptions = {}) {
    this.token = options.token ?? null;
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? sleepDefault;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = options.baseUrl ?? API_ORIGIN;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxPages = options.maxPages ?? 10;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxInlineWaitSeconds = options.maxInlineWaitSeconds ?? 30;
  }

  get hasToken(): boolean {
    return this.token !== null;
  }

  toJSON() {
    return { hasToken: this.hasToken };
  }

  private headers(etag?: string | null): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'career-os-myos',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (etag) h['If-None-Match'] = etag;
    return h;
  }

  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http')) {
      // Never follow a pagination URL off the API origin — it would leak the token.
      if (!pathOrUrl.startsWith(this.baseUrl + '/')) {
        throw new GithubApiError('Refusing to follow a non-GitHub URL');
      }
      return pathOrUrl;
    }
    return `${this.baseUrl}${pathOrUrl}`;
  }

  /** Single request with retry/backoff and rate-limit classification. 304 is returned as-is. */
  async request(pathOrUrl: string, opts: { etag?: string | null } = {}): Promise<Result> {
    const url = this.resolveUrl(pathOrUrl);
    const label = url.replace(this.baseUrl, '').split('?')[0]!;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: 'GET',
          headers: this.headers(opts.etag),
        });
      } catch {
        // Deliberately drop the underlying error: it is not needed and could echo request data.
        lastError = new GithubApiError(`Network error calling GitHub ${label}`);
        if (attempt < this.maxAttempts)
          await this.sleep(this.baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }

      if (res.status === 304) return { status: 304, data: null, headers: res.headers };
      if (res.status >= 200 && res.status < 300) {
        let data: unknown = null;
        if (res.status !== 204) {
          try {
            data = await res.json();
          } catch {
            data = null;
          }
        }
        return { status: res.status, data, headers: res.headers };
      }
      if (res.status === 401) throw new AuthError(label);
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        const retryAfter = res.headers.get('retry-after');
        if (remaining === '0') {
          const resetAt = reset ? new Date(Number(reset) * 1000) : null;
          throw new RateLimitError(
            resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : null,
          );
        }
        if (retryAfter) {
          const seconds = Math.max(0, Number(retryAfter) || 0);
          if (seconds <= this.maxInlineWaitSeconds && attempt < this.maxAttempts) {
            await this.sleep(seconds * 1000);
            continue;
          }
          throw new RateLimitError(new Date(this.now().getTime() + seconds * 1000), true);
        }
        if (res.status === 429) throw new RateLimitError(null, true);
        throw new NotFoundError(label, 403);
      }
      if (res.status === 404) throw new NotFoundError(label);
      if (res.status >= 500) {
        lastError = new GithubApiError(
          `GitHub server error ${res.status} on ${label}`,
          res.status,
        );
        if (attempt < this.maxAttempts)
          await this.sleep(this.baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }
      throw new GithubApiError(
        `Unexpected GitHub response ${res.status} on ${label}`,
        res.status,
      );
    }
    throw lastError ?? new GithubApiError(`GitHub request failed: ${label}`);
  }

  /** Follows Link rel="next" up to `maxPages`. Result is the concatenated array. */
  async paginate<T>(path: string, maxPages = this.maxPages): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < maxPages; page++) {
      const res: Result = await this.request(next);
      if (Array.isArray(res.data)) items.push(...(res.data as T[]));
      next = parseLink(res.headers.get('link')).next;
    }
    return items;
  }

  /**
   * Counts a collection without walking it: request per_page=1 and read the page number of the
   * rel="last" Link (== total items). Without a Link header the single page's length is the count.
   */
  private async countViaLink(path: string): Promise<number> {
    const sep = path.includes('?') ? '&' : '?';
    let res: Result;
    try {
      res = await this.request(`${path}${sep}per_page=1`);
    } catch (e) {
      // 409 = empty repository (no commits); treat as zero rather than failing the repo.
      if (e instanceof GithubApiError && e.status === 409) return 0;
      throw e;
    }
    const last = parseLink(res.headers.get('link')).last;
    if (last) {
      const page = Number(new URL(last).searchParams.get('page'));
      if (Number.isFinite(page) && page > 0) return page;
    }
    return Array.isArray(res.data) ? res.data.length : 0;
  }

  /** `GET /user` — used to validate a token. Returns login + numeric id. */
  async getAuthenticatedUser(): Promise<{ login: string; id: number }> {
    const res = await this.request('/user');
    const d = res.data as { login?: string; id?: number } | null;
    if (!d || typeof d.login !== 'string' || typeof d.id !== 'number') {
      throw new GithubApiError('Unexpected response from GitHub /user');
    }
    return { login: d.login, id: d.id };
  }

  /**
   * Public-only `/users/{login}/repos` without a token; `/user/repos?affiliation=owner` with one
   * (includes private), filtered to repos owned by `login`. Capped at maxPages * 100 repos.
   */
  async listRepositories(login: string): Promise<RawRepo[]> {
    const path = this.token
      ? '/user/repos?affiliation=owner&sort=pushed&per_page=100'
      : `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`;
    const repos = await this.paginate<RawRepo>(path);
    const wanted = login.toLowerCase();
    return repos.filter((r) => r.owner?.login?.toLowerCase() === wanted);
  }

  async getRepository(fullName: string, etag?: string | null): Promise<RepoDetailResult> {
    const res = await this.request(`/repos/${fullName}`, { etag });
    if (res.status === 304) return { notModified: true, repo: null, etag: etag ?? null };
    return {
      notModified: false,
      repo: res.data as RawRepo,
      etag: res.headers.get('etag'),
    };
  }

  async getLanguages(fullName: string): Promise<Record<string, number>> {
    const res = await this.request(`/repos/${fullName}/languages`);
    return (res.data as Record<string, number>) ?? {};
  }

  /** Decodes the base64 README, capped to README_MAX_CHARS. Null when the repo has none. */
  async getReadme(fullName: string): Promise<ReadmeResult | null> {
    try {
      const res = await this.request(`/repos/${fullName}/readme`);
      const d = res.data as { content?: string; encoding?: string; sha?: string } | null;
      if (!d || typeof d.content !== 'string' || typeof d.sha !== 'string') return null;
      const text =
        d.encoding === 'base64'
          ? Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf8')
          : d.content;
      return { text: text.slice(0, README_MAX_CHARS), sha: d.sha };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  /** Top contributors (first page only, max 10). */
  async getContributors(
    fullName: string,
  ): Promise<{ login: string; contributions: number }[]> {
    try {
      const res = await this.request(
        `/repos/${fullName}/contributors?per_page=${MAX_CONTRIBUTORS}`,
      );
      if (!Array.isArray(res.data)) return [];
      return (res.data as { login?: string; contributions?: number }[])
        .filter((c) => typeof c.login === 'string' && typeof c.contributions === 'number')
        .slice(0, MAX_CONTRIBUTORS)
        .map((c) => ({ login: c.login!, contributions: c.contributions! }));
    } catch (e) {
      if (e instanceof NotFoundError) return [];
      throw e;
    }
  }

  /** Total PR count (all states) via the per_page=1 Link-last trick: one request, no walking. */
  countPullRequests(fullName: string): Promise<number> {
    return this.countViaLink(`/repos/${fullName}/pulls?state=all`);
  }

  /** Total commit count on the default branch via the same Link-last trick. */
  countCommits(fullName: string): Promise<number> {
    return this.countViaLink(`/repos/${fullName}/commits`);
  }

  /**
   * Bounded evidence sample: at most MAX_PR_SAMPLE most recently updated merged PRs authored by
   * `login`, from one search request. The full PR history is never walked.
   */
  async listMergedPullRequests(fullName: string, login: string): Promise<MergedPr[]> {
    const q = encodeURIComponent(`repo:${fullName} type:pr author:${login} is:merged`);
    const res = await this.request(
      `/search/issues?q=${q}&sort=updated&order=desc&per_page=${MAX_PR_SAMPLE}`,
    );
    const items = ((res.data as { items?: unknown[] } | null)?.items ?? []) as {
      number?: number;
      title?: string;
      html_url?: string;
      pull_request?: { merged_at?: string | null };
      closed_at?: string | null;
    }[];
    const out: MergedPr[] = [];
    for (const it of items) {
      const mergedAt = it.pull_request?.merged_at ?? it.closed_at;
      if (typeof it.number !== 'number' || !it.title || !it.html_url || !mergedAt)
        continue;
      out.push({ number: it.number, title: it.title, url: it.html_url, mergedAt });
    }
    return out.slice(0, MAX_PR_SAMPLE);
  }
}
