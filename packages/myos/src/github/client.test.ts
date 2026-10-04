import { describe, expect, it, vi } from 'vitest';
import { GithubClient } from './client';
import { AuthError, NotFoundError, RateLimitError } from './errors';

const TOKEN = 'ghp_SECRETTOKENVALUE1234567890abcd';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

function client(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  token?: string,
) {
  const sleep = vi.fn(async () => {});
  return {
    sleep,
    c: new GithubClient({
      fetch: fetchFn,
      sleep,
      token,
      now: () => new Date('2026-01-01T00:00:00Z'),
    }),
  };
}

describe('GithubClient', () => {
  it('sends GitHub headers and Bearer token only when provided', async () => {
    const seen: Record<string, string>[] = [];
    const f = async (_u: string, init?: RequestInit) => {
      seen.push(init!.headers as Record<string, string>);
      return json({ login: 'octo', id: 1 });
    };
    await client(f).c.getAuthenticatedUser();
    await client(f, TOKEN).c.getAuthenticatedUser();
    expect(seen[0]!.Accept).toBe('application/vnd.github+json');
    expect(seen[0]!['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(seen[0]!.Authorization).toBeUndefined();
    expect(seen[1]!.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('follows Link pagination and caps pages', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      const page = Number(new URL(u).searchParams.get('page') ?? '1');
      return json([{ n: page }], {
        headers: { link: `<https://api.github.com/x?page=${page + 1}>; rel="next"` },
      });
    };
    const { c } = client(f);
    const items = await c.paginate<{ n: number }>('/x', 3);
    expect(items.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(urls).toHaveLength(3);
  });

  it('refuses to follow a pagination link off the API origin (token leak guard)', async () => {
    const f = async () =>
      json([{ n: 1 }], {
        headers: { link: '<https://evil.example/x?page=2>; rel="next"' },
      });
    await expect(client(f, TOKEN).c.paginate('/x')).rejects.toThrow(/non-GitHub URL/);
  });

  it('sends If-None-Match and reports 304', async () => {
    let inm: string | undefined;
    const f = async (_u: string, init?: RequestInit) => {
      inm = (init!.headers as Record<string, string>)['If-None-Match'];
      return new Response(null, { status: 304 });
    };
    const r = await client(f).c.getRepository('o/r', 'W/"abc"');
    expect(inm).toBe('W/"abc"');
    expect(r).toMatchObject({ notModified: true, repo: null });
  });

  it('throws RateLimitError with resetAt when the primary limit is exhausted', async () => {
    const f = async () =>
      json(
        {},
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
        },
      );
    const err = await client(f)
      .c.getLanguages('o/r')
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('honors a short Retry-After on secondary limits, then succeeds', async () => {
    let n = 0;
    const f = async () =>
      n++ === 0
        ? json({}, { status: 403, headers: { 'retry-after': '2' } })
        : json({ TS: 5 });
    const { c, sleep } = client(f);
    expect(await c.getLanguages('o/r')).toEqual({ TS: 5 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('throws secondary RateLimitError for a long Retry-After', async () => {
    const f = async () => json({}, { status: 429, headers: { 'retry-after': '600' } });
    const err = await client(f)
      .c.getLanguages('o/r')
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.secondary).toBe(true);
    expect(err.resetAt.toISOString()).toBe('2026-01-01T00:10:00.000Z');
  });

  it('maps 401 and 404/403 to typed errors', async () => {
    await expect(
      client(async () => json({}, { status: 401 })).c.getLanguages('o/r'),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      client(async () => json({}, { status: 404 })).c.getLanguages('o/r'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      client(async () => json({}, { status: 403 })).c.getLanguages('o/r'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('retries 5xx and network errors with exponential backoff, max 3 attempts', async () => {
    let n = 0;
    const f = async () => {
      n++;
      if (n === 1) throw new Error('socket hang up');
      if (n === 2) return json({}, { status: 502 });
      return json({ Go: 1 });
    };
    const { c, sleep } = client(f);
    expect(await c.getLanguages('o/r')).toEqual({ Go: 1 });
    expect(n).toBe(3);
    expect(sleep.mock.calls.map((x) => (x as unknown[])[0])).toEqual([500, 1000]);

    let m = 0;
    const always = async () => {
      m++;
      return json({}, { status: 500 });
    };
    await expect(client(always).c.getLanguages('o/r')).rejects.toThrow(
      /server error 500/,
    );
    expect(m).toBe(3);
  });

  it('never leaks the token in thrown errors or console output', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((k) =>
      vi.spyOn(console, k),
    );
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new Error(`boom Bearer ${TOKEN}`);
      },
      async () => json({ message: TOKEN }, { status: 500 }),
      async () => json({ message: TOKEN }, { status: 401 }),
      async () => json({ message: TOKEN }, { status: 404 }),
      async () => json({ message: TOKEN }, { status: 422 }),
      async () => json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ];
    for (const f of cases) {
      const err = await client(f, TOKEN)
        .c.getLanguages('o/r')
        .catch((e) => e as Error);
      expect(String(err.message)).not.toContain(TOKEN);
      expect(String(err.stack)).not.toContain(TOKEN);
    }
    expect(JSON.stringify(client(async () => json({}), TOKEN).c)).not.toContain(TOKEN);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
      s.mockRestore();
    }
  });

  it('counts PRs/commits via the per_page=1 Link-last trick', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      return json([{ x: 1 }], {
        headers: {
          link: '<https://api.github.com/r?per_page=1&page=2>; rel="next", <https://api.github.com/r?per_page=1&page=482>; rel="last"',
        },
      });
    };
    const { c } = client(f);
    expect(await c.countPullRequests('o/r')).toBe(482);
    expect(urls[0]).toContain('per_page=1');
    expect(urls).toHaveLength(1);
  });

  it('treats an empty repo (409) as zero commits and returns single-page length otherwise', async () => {
    expect(
      await client(async () => json({}, { status: 409 })).c.countCommits('o/r'),
    ).toBe(0);
    expect(await client(async () => json([{ a: 1 }])).c.countPullRequests('o/r')).toBe(1);
  });

  it('decodes and caps the README and records its sha', async () => {
    const big = 'x'.repeat(9000);
    const f = async () =>
      json({
        content: Buffer.from(big).toString('base64'),
        encoding: 'base64',
        sha: 'abc',
      });
    const r = await client(f).c.getReadme('o/r');
    expect(r!.text).toHaveLength(6000);
    expect(r!.sha).toBe('abc');
    expect(
      await client(async () => json({}, { status: 404 })).c.getReadme('o/r'),
    ).toBeNull();
  });

  it('lists public repos by login without a token and filters to owner with a token', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      return json([
        { id: 1, owner: { login: 'Octo' } },
        { id: 2, owner: { login: 'someone-else' } },
      ]);
    };
    const pub = await client(f).c.listRepositories('octo');
    expect(urls[0]).toContain('/users/octo/repos');
    expect(pub.map((r) => r.id)).toEqual([1]);
    const priv = await client(f, TOKEN).c.listRepositories('octo');
    expect(urls[1]).toContain('/user/repos?affiliation=owner');
    expect(priv.map((r) => r.id)).toEqual([1]);
  });

  it('bounds the PR sample to 30 merged PRs from one search request', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      return json({
        items: Array.from({ length: 40 }, (_, i) => ({
          number: i + 1,
          title: `PR ${i}`,
          html_url: `https://github.com/o/r/pull/${i + 1}`,
          pull_request: { merged_at: '2025-01-01T00:00:00Z' },
        })),
      });
    };
    const prs = await client(f).c.listMergedPullRequests('o/r', 'octo');
    expect(prs).toHaveLength(30);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('per_page=30');
  });
});
