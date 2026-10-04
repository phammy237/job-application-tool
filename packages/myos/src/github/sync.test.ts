import { describe, expect, it, vi } from 'vitest';
import type {
  GithubRepository,
  GithubRepoSnapshot,
  MyosEvidenceInput,
} from '@career-os/shared';
import { GithubClient } from './client';
import { syncGithubRepositories, type GithubSyncStore } from './sync';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'ghp_SECRETTOKENVALUE1234567890abcd';

function repo(id: number, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    full_name: `octo/${name}`,
    description: `${name} desc`,
    html_url: `https://github.com/octo/${name}`,
    private: false,
    fork: false,
    archived: false,
    default_branch: 'main',
    language: 'TypeScript',
    topics: ['cli'],
    stargazers_count: 3,
    created_at: '2024-01-01T00:00:00Z',
    pushed_at: '2026-06-01T00:00:00Z',
    owner: { login: 'octo' },
    ...over,
  };
}

const json = (b: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(b), { status: 200, ...init });

/** Fake GitHub: routes by pathname; records every request. */
function fakeGithub(
  repos: ReturnType<typeof repo>[],
  opts: { failRepo?: string; rateLimitOn?: string } = {},
) {
  const calls: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push(u.pathname + (u.search ? '' : ''));
    const p = u.pathname;
    if (p === '/user/repos' || p === '/users/octo/repos') return json(repos);
    const m = p.match(/^\/repos\/octo\/([^/]+)(\/.*)?$/);
    if (m) {
      const [, name, rest] = m;
      if (opts.failRepo === name && rest === '/languages')
        return json({}, { status: 500 });
      if (opts.rateLimitOn === name && rest === '/languages')
        return json(
          {},
          {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
          },
        );
      const r = repos.find((x) => x.name === name)!;
      if (!rest) {
        const inm = (init!.headers as Record<string, string>)['If-None-Match'];
        if (inm === 'etag-1') return new Response(null, { status: 304 });
        return json(r, { headers: { etag: 'etag-1' } });
      }
      if (rest === '/languages') return json({ TypeScript: 900 });
      if (rest === '/readme')
        return json({
          content: Buffer.from(`# ${name}\n${'z'.repeat(3000)}`).toString('base64'),
          encoding: 'base64',
          sha: 'sha1',
        });
      if (rest === '/contributors') return json([{ login: 'octo', contributions: 5 }]);
      if (rest === '/pulls' || rest === '/commits')
        return json([{ a: 1 }], {
          headers: { link: '<https://api.github.com/x?page=7>; rel="last"' },
        });
    }
    if (p === '/search/issues')
      return json({
        items: [1, 2].map((n) => ({
          number: n,
          title: `PR ${n}`,
          html_url: `https://github.com/octo/x/pull/${n}`,
          pull_request: { merged_at: '2026-05-0' + n + 'T00:00:00Z' },
        })),
      });
    return json({}, { status: 404 });
  };
  return { calls, fetchFn };
}

function memStore(initial: GithubRepository[] = []) {
  const repos = new Map<number, GithubRepository>(
    initial.map((r) => [r.githubRepoId, r]),
  );
  const evidence = new Map<string, MyosEvidenceInput>();
  const runs: {
    status?: string;
    stats?: Record<string, unknown>;
    error?: string | null;
  }[] = [];
  const errors: { id: string; msg: string }[] = [];
  const store: GithubSyncStore = {
    listRepositories: async () => [...repos.values()],
    upsertRepositorySnapshot: async (_u, s: GithubRepoSnapshot) => {
      const prev = repos.get(s.githubRepoId);
      repos.set(s.githubRepoId, {
        id:
          prev?.id ??
          `00000000-0000-4000-8000-${String(s.githubRepoId).padStart(12, '0')}`,
        userId: USER,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        selected: prev?.selected ?? false,
        projectId: prev?.projectId ?? null,
        lastSyncedAt: null,
        ...s,
        syncStatus: 'SYNCED',
        syncError: null,
      } as GithubRepository);
    },
    markRepositorySyncError: async (_u, rowId, msg) => {
      errors.push({ id: rowId, msg });
      const r = [...repos.values()].find((x) => x.id === rowId);
      if (r) repos.set(r.githubRepoId, { ...r, syncStatus: 'ERROR', syncError: msg });
    },
    startSyncRun: async () => {
      runs.push({});
      return { id: `run-${runs.length}` };
    },
    finishSyncRun: async (_u, _id, res) => {
      Object.assign(runs[runs.length - 1]!, res);
    },
    upsertEvidenceBySource: async (_u, input) => {
      const key = `${input.sourceType}|${input.sourceRef}`;
      const created = !evidence.has(key);
      evidence.set(key, input);
      return { id: key, created };
    },
  };
  return {
    store,
    repos,
    evidence,
    runs,
    errors,
    select: (id: number) => repos.set(id, { ...repos.get(id)!, selected: true }),
  };
}

function setup(repos: ReturnType<typeof repo>[], gh = fakeGithub(repos), token?: string) {
  const client = new GithubClient({ fetch: gh.fetchFn, sleep: async () => {}, token });
  return { gh, client };
}

async function run(m: ReturnType<typeof memStore>, client: GithubClient) {
  return syncGithubRepositories({
    store: m.store,
    client,
    userId: USER,
    login: 'octo',
    now: () => new Date('2026-07-01T00:00:00Z'),
  });
}

describe('syncGithubRepositories', () => {
  it('lists all repos but only deep-syncs selected ones', async () => {
    const repos = [repo(1, 'alpha'), repo(2, 'beta')];
    const m = memStore();
    const { gh, client } = setup(repos);
    const first = await run(m, client);
    expect(first.status).toBe('SUCCEEDED');
    expect(first.stats.metadataUpserted).toBe(2);
    expect(gh.calls.some((c) => c.includes('/readme'))).toBe(false);
    expect(m.evidence.size).toBe(0);

    m.select(1);
    gh.calls.length = 0;
    const second = await run(m, client);
    expect(second.stats.detailSynced).toBe(1);
    expect(gh.calls.filter((c) => c.includes('/beta'))).toHaveLength(0);
    const types = [...m.evidence.keys()].sort();
    expect(types).toEqual([
      'GITHUB_PR|octo/alpha#1',
      'GITHUB_PR|octo/alpha#2',
      'GITHUB_README|octo/alpha',
      'GITHUB_REPO|octo/alpha',
    ]);
    const readme = m.evidence.get('GITHUB_README|octo/alpha')!;
    expect(readme.excerpt!.length).toBeLessThanOrEqual(2000);
    expect(readme.verificationState).toBe('VERIFIED');
    const r = m.evidence.get('GITHUB_REPO|octo/alpha')!;
    expect(r.occurredAt).toBe('2026-06-01T00:00:00.000Z');
    expect(r.metadata).toMatchObject({ languages: { TypeScript: 900 }, topics: ['cli'] });
    expect(m.repos.get(1)).toMatchObject({
      syncStatus: 'SYNCED',
      prCount: 7,
      commitCount: 7,
      etag: 'etag-1',
    });
  });

  it('is idempotent: a second run makes no new evidence and no detail fetches', async () => {
    const repos = [repo(1, 'alpha'), repo(2, 'beta')];
    const m = memStore();
    const { gh, client } = setup(repos);
    await run(m, client);
    m.select(1);
    m.select(2);
    await run(m, client);
    const evidenceCount = m.evidence.size;
    gh.calls.length = 0;
    const again = await run(m, client);
    expect(again.stats.evidenceCreated).toBe(0);
    expect(again.stats.evidenceUpdated).toBe(0);
    expect(again.stats.detailSynced).toBe(0);
    expect(again.stats.skippedUnchanged).toBe(2);
    expect(m.evidence.size).toBe(evidenceCount);
    expect(gh.calls.filter((c) => c.startsWith('/repos/'))).toHaveLength(0);
  });

  it('re-syncs on changed pushed_at, but a 304 on the conditional repo request skips it', async () => {
    const repos = [repo(1, 'alpha')];
    const m = memStore();
    const { gh, client } = setup(repos);
    await run(m, client);
    m.select(1);
    await run(m, client);
    // pushed_at changes on the listing but the conditional detail request returns 304
    repos[0]!.pushed_at = '2026-06-20T00:00:00Z';
    gh.calls.length = 0;
    const res = await run(m, client);
    expect(res.stats.skippedUnchanged).toBe(1);
    expect(res.stats.detailSynced).toBe(0);
    expect(gh.calls.filter((c) => c.endsWith('/readme'))).toHaveLength(0);
  });

  it('isolates a failing repo (ERROR, sanitized, PARTIAL) and retries only it next run', async () => {
    const repos = [repo(1, 'alpha'), repo(2, 'beta')];
    const m = memStore();
    await run(m, setup(repos).client);
    m.select(1);
    m.select(2);
    const broken = setup(repos, fakeGithub(repos, { failRepo: 'alpha' }), TOKEN);
    const res = await run(m, broken.client);
    expect(res.status).toBe('PARTIAL');
    expect(res.stats.failed).toBe(1);
    expect(m.repos.get(1)!.syncStatus).toBe('ERROR');
    expect(m.repos.get(2)!.syncStatus).toBe('SYNCED');
    expect(m.errors[0]!.msg).not.toContain(TOKEN);
    expect(m.errors[0]!.msg.length).toBeLessThanOrEqual(200);

    const healthy = setup(repos);
    const retry = await run(m, healthy.client);
    expect(retry.status).toBe('SUCCEEDED');
    expect(retry.stats.detailSynced).toBe(1);
    expect(healthy.gh.calls.filter((c) => c.startsWith('/repos/octo/beta'))).toHaveLength(
      0,
    );
    expect(m.repos.get(1)!.syncStatus).toBe('SYNCED');
  });

  it('stops gracefully on rate limit: PARTIAL with resetAt, remaining repos untouched', async () => {
    const repos = [repo(1, 'alpha'), repo(2, 'beta')];
    const m = memStore();
    await run(m, setup(repos).client);
    m.select(1);
    m.select(2);
    const limited = setup(repos, fakeGithub(repos, { rateLimitOn: 'alpha' }));
    const res = await run(m, limited.client);
    expect(res.status).toBe('PARTIAL');
    expect(res.stats.rateLimited).toBe(true);
    expect(res.stats.rateLimitResetAt).toBe(new Date(1790000000 * 1000).toISOString());
    expect(limited.gh.calls.filter((c) => c.startsWith('/repos/octo/beta'))).toHaveLength(
      0,
    );
    expect(m.runs.at(-1)!.status).toBe('PARTIAL');
    expect(m.errors).toHaveLength(0);
  });

  it('marks the run FAILED on bad credentials without leaking the token', async () => {
    const m = memStore();
    const client = new GithubClient({
      token: TOKEN,
      sleep: async () => {},
      fetch: async () => new Response('{}', { status: 401 }),
    });
    const spy = vi.spyOn(console, 'error');
    const res = await run(m, client);
    expect(res.status).toBe('FAILED');
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });

  it('keeps private-repo evidence PRIVATE and flags the repo private', async () => {
    const repos = [repo(1, 'secret', { private: true }), repo(2, 'open')];
    const m = memStore();
    const { client } = setup(repos, undefined, TOKEN);
    await run(m, client);
    expect(m.repos.get(1)!.isPrivate).toBe(true);
    m.select(1);
    m.select(2);
    await run(m, client);
    expect(m.evidence.size).toBeGreaterThan(0);
    for (const e of m.evidence.values()) {
      expect(e.visibility).toBe('PRIVATE');
      expect(e.verificationState).toBe('VERIFIED');
    }
    expect(m.evidence.get('GITHUB_REPO|octo/secret')!.metadata).toMatchObject({
      isPrivate: true,
    });
  });
});
