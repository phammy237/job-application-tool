import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSafeRedirects, MAX_REDIRECTS, type HostnameResolver } from './safe-page-fetch';

const PUBLIC_IP = '93.184.216.34';
const publicResolver: HostnameResolver = async () => [PUBLIC_IP];
const HEADERS = { 'User-Agent': 'test-agent' };

const redirect = (location: string | null, status = 302): Response =>
  new Response(null, { status, headers: location === null ? {} : { location } });
const ok = (body = '<html></html>'): Response => new Response(body, { status: 200 });

/** Serves `routes` by exact URL (or a function for sequences); records every requested URL. */
function serve(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected request to ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const run = (url: string, extra: Partial<Parameters<typeof fetchWithSafeRedirects>[1]> = {}) =>
  fetchWithSafeRedirects(url, { headers: HEADERS, timeoutMs: 5_000, resolveHost: publicResolver, ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithSafeRedirects — successful paths', () => {
  it('fetches a public URL with no redirect: manual mode, only the given headers, final URL unchanged', async () => {
    const fetchMock = serve({ 'https://careers.example.com/job/1': () => ok() });
    const result = await run('https://careers.example.com/job/1');
    expect(result).toMatchObject({ kind: 'response', finalUrl: 'https://careers.example.com/job/1', redirects: 0 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual(HEADERS);
  });

  it('follows a public employer URL to another public employer/branded domain (careers.tiktok.com → lifeattiktok.com shape)', async () => {
    serve({
      'https://careers.tiktok.com/m/position/7662640431646279989/detail': () =>
        redirect('https://lifeattiktok.com/search/7662640431646279989'),
      'https://lifeattiktok.com/search/7662640431646279989': () => ok(),
    });
    const result = await run('https://careers.tiktok.com/m/position/7662640431646279989/detail');
    expect(result).toMatchObject({
      kind: 'response',
      finalUrl: 'https://lifeattiktok.com/search/7662640431646279989',
      redirects: 1,
    });
  });

  it.each([
    ['root-relative', '/en/job/42', 'https://careers.example.com/en/job/42'],
    ['path-relative', '../other/42', 'https://careers.example.com/a/other/42'],
    ['query-only', '?lang=fr', 'https://careers.example.com/a/b/c?lang=fr'],
    ['protocol-relative', '//jobs.example.org/x', 'https://jobs.example.org/x'],
  ])('resolves a %s Location against the previous URL', async (_label, location, expected) => {
    serve({
      'https://careers.example.com/a/b/c': () => redirect(location, 301),
      [expected]: () => ok(),
    });
    const result = await run('https://careers.example.com/a/b/c');
    expect(result).toMatchObject({ kind: 'response', finalUrl: expected });
  });

  it('allows a chain of exactly MAX_REDIRECTS redirects', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < MAX_REDIRECTS; i += 1) routes[`https://h${i}.example.com/`] = () => redirect(`https://h${i + 1}.example.com/`);
    routes[`https://h${MAX_REDIRECTS}.example.com/`] = () => ok();
    const fetchMock = serve(routes);
    const result = await run('https://h0.example.com/');
    expect(result).toMatchObject({ kind: 'response', redirects: MAX_REDIRECTS, finalUrl: `https://h${MAX_REDIRECTS}.example.com/` });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('returns a non-redirect 3xx (304) and error statuses as the final response', async () => {
    serve({ 'https://a.example.com/': () => new Response(null, { status: 304 }) });
    expect(await run('https://a.example.com/')).toMatchObject({ kind: 'response' });
    serve({ 'https://a.example.com/': () => new Response('nope', { status: 404 }) });
    const notFound = await run('https://a.example.com/');
    expect(notFound.kind === 'response' && notFound.response.status).toBe(404);
  });

  it('supports HEAD', async () => {
    const fetchMock = serve({ 'https://a.example.com/': () => ok() });
    await run('https://a.example.com/', { method: 'HEAD' });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('HEAD');
  });

  it('skips DNS for a public IP-literal host', async () => {
    serve({ [`https://${PUBLIC_IP}/`]: () => ok() });
    const resolveHost = vi.fn(publicResolver);
    expect(await run(`https://${PUBLIC_IP}/`, { resolveHost })).toMatchObject({ kind: 'response' });
    expect(resolveHost).not.toHaveBeenCalled();
  });
});

describe('fetchWithSafeRedirects — redirect limit', () => {
  it('refuses a redirect beyond MAX_REDIRECTS (6th redirect)', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i <= MAX_REDIRECTS; i += 1) routes[`https://h${i}.example.com/`] = () => redirect(`https://h${i + 1}.example.com/`);
    const fetchMock = serve(routes);
    const result = await run('https://h0.example.com/');
    expect(result).toMatchObject({ kind: 'failed' });
    expect(result.kind === 'failed' && result.reason).toMatch(/too many redirects/);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1); // the 6th redirect target is never requested
  });

  it('refuses a redirect loop', async () => {
    serve({ 'https://loop.example.com/': () => redirect('https://loop.example.com/') });
    expect(await run('https://loop.example.com/')).toMatchObject({ kind: 'failed' });
  });
});

describe('fetchWithSafeRedirects — unsafe destinations are never requested', () => {
  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.4.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://0.0.0.0/',
    'http://[::]/',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.com/',
    'http://internal.internal/',
  ])('a redirect to %s is blocked without being requested', async (target) => {
    const fetchMock = serve({ 'https://careers.example.com/job': () => redirect(target) });
    const result = await run('https://careers.example.com/job');
    expect(result.kind).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the first hop was ever requested
  });

  it('blocks an unsafe INITIAL url without any request', async () => {
    const fetchMock = serve({});
    expect((await run('http://169.254.169.254/')).kind).toBe('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a redirect chain that ends in a private address is blocked mid-chain', async () => {
    const fetchMock = serve({
      'https://a.example.com/': () => redirect('https://b.example.com/'),
      'https://b.example.com/': () => redirect('http://192.168.0.10/admin'),
    });
    expect((await run('https://a.example.com/')).kind).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchWithSafeRedirects — DNS-based protection', () => {
  it('blocks a hostname that resolves to a private address, before any request', async () => {
    const fetchMock = serve({});
    const result = await run('https://looks-public.example.com/', { resolveHost: async () => ['10.1.2.3'] });
    expect(result).toMatchObject({ kind: 'blocked' });
    expect(result.kind === 'blocked' && result.reason).toMatch(/non-public address \(10\.1\.2\.3\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['link-local metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique-local', 'fd12::1'],
    ['unspecified', '0.0.0.0'],
  ])('blocks when ANY resolved address is non-public (%s), even alongside a public one', async (_label, bad) => {
    serve({});
    const result = await run('https://mixed.example.com/', { resolveHost: async () => [PUBLIC_IP, bad] });
    expect(result.kind).toBe('blocked');
  });

  it('re-resolves and checks every redirect hop: a public host redirecting to a name that resolves privately is blocked', async () => {
    const resolveHost: HostnameResolver = async (host) => (host === 'sneaky.example.net' ? ['192.168.5.5'] : [PUBLIC_IP]);
    const fetchMock = serve({ 'https://a.example.com/': () => redirect('https://sneaky.example.net/x') });
    const result = await run('https://a.example.com/', { resolveHost });
    expect(result).toMatchObject({ kind: 'blocked', url: 'https://sneaky.example.net/x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a DNS error and on an empty answer', async () => {
    serve({});
    const failing = await run('https://a.example.com/', {
      resolveHost: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(failing.kind === 'blocked' && failing.reason).toMatch(/dns lookup failed: ENOTFOUND/);
    expect((await run('https://a.example.com/', { resolveHost: async () => [] })).kind).toBe('blocked');
  });
});

describe('fetchWithSafeRedirects — malformed redirects', () => {
  it('a redirect response with no Location header fails safely', async () => {
    serve({ 'https://a.example.com/': () => redirect(null) });
    const result = await run('https://a.example.com/');
    expect(result).toMatchObject({ kind: 'failed' });
    expect(result.kind === 'failed' && result.reason).toMatch(/without a Location/);
  });

  it.each(['http://', 'http://[::1', 'https://exa mple.com/', '//'])('a malformed Location (%s) fails safely', async (bad) => {
    serve({ 'https://a.example.com/': () => redirect(bad) });
    expect((await run('https://a.example.com/')).kind).toMatch(/failed|blocked/);
  });
});

describe('fetchWithSafeRedirects — timeout', () => {
  it('aborts a request that never answers, within the overall timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
          }),
      ),
    );
    const started = Date.now();
    const result = await run('https://slow.example.com/', { timeoutMs: 40 });
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.reason).toMatch(/network error/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the timeout covers DNS too: a hanging lookup is aborted and fails closed', async () => {
    serve({});
    const result = await run('https://slow-dns.example.com/', { timeoutMs: 40, resolveHost: () => new Promise(() => {}) });
    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' && result.reason).toMatch(/dns lookup failed/);
  });

  it('one budget spans the whole redirect chain (a slow later hop still times out)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) =>
        url === 'https://a.example.com/'
          ? Promise.resolve(redirect('https://b.example.com/'))
          : new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
            }),
      ),
    );
    expect((await run('https://a.example.com/', { timeoutMs: 40 })).kind).toBe('failed');
  });
});

describe('fetchWithSafeRedirects — redirect bodies', () => {
  it('cancels the body of each redirect response it follows', async () => {
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled += 1;
      },
    });
    serve({
      'https://a.example.com/': () => new Response(stream, { status: 302, headers: { location: 'https://b.example.com/' } }),
      'https://b.example.com/': () => ok(),
    });
    expect((await run('https://a.example.com/')).kind).toBe('response');
    expect(cancelled).toBe(1);
  });
});

describe('fetchWithSafeRedirects — network error diagnostics', () => {
  it('surfaces the underlying cause code behind undici\'s generic "fetch failed"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      }),
    );
    const result = await run('https://a.example.com/');
    expect(result).toMatchObject({ kind: 'failed', reason: 'network error: fetch failed (ECONNRESET)' });
  });
});
