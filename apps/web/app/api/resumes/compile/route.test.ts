import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/resumes/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  process.env.RESUME_COMPILER_URL = '';
  process.env.RESUME_COMPILER_TOKEN = '';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('POST /api/resumes/compile', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await POST(jsonRequest({ latex: 'x' }));
    expect(res.status).toBe(401);
  });

  it('honestly reports not_configured when no compiler service is set up — never fakes a PDF', async () => {
    const res = await POST(jsonRequest({ latex: '\\documentclass{article}' }));
    const body = (await res.json()) as { status: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe('not_configured');
  });

  it('rejects a missing latex field', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com';
    process.env.RESUME_COMPILER_TOKEN = 'secret';
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized source before ever calling the compiler service', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com';
    process.env.RESUME_COMPILER_TOKEN = 'secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(jsonRequest({ latex: 'x'.repeat(300_000) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to the compiler service with the shared-secret header and streams back PDF bytes on success', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com/';
    process.env.RESUME_COMPILER_TOKEN = 'secret-token';
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(jsonRequest({ latex: '\\documentclass{article}' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://compiler.example.com/compile');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  it('maps a 422 compiler response to a compile_error status with a line number, never the raw upstream error verbatim structure', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com';
    process.env.RESUME_COMPILER_TOKEN = 'secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Undefined control sequence', line: 12 }), { status: 422 }),
      ),
    );

    const res = await POST(jsonRequest({ latex: '\\bogus' }));
    const body = (await res.json()) as { status: string; line?: number };
    expect(res.status).toBe(422);
    expect(body.status).toBe('compile_error');
    expect(body.line).toBe(12);
  });

  it('never exposes the compiler service being unreachable as a raw error, and never crashes', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com';
    process.env.RESUME_COMPILER_TOKEN = 'secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(jsonRequest({ latex: '\\documentclass{article}' }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(502);
    expect(body.error).not.toMatch(/ECONNREFUSED/);
    consoleSpy.mockRestore();
  });

  it('a repeat unrelated 500 from the compiler service never leaks upstream details', async () => {
    process.env.RESUME_COMPILER_URL = 'https://compiler.example.com';
    process.env.RESUME_COMPILER_TOKEN = 'secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'spawn tectonic ENOENT' }), { status: 500 })),
    );

    const res = await POST(jsonRequest({ latex: '\\documentclass{article}' }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(502);
    expect(body.error).not.toMatch(/ENOENT|tectonic|spawn/i);
  });
});
