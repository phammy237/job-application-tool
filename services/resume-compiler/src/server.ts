import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Career OS résumé compile service — standalone, deployed outside Vercel (see README.md for
 * why: no LaTeX distribution fits Vercel's serverless function size limit, and Vercel gives no
 * way to guarantee "no network access from the compile process"). Never runs inside the main
 * Next.js app's process. Talks to Career OS over one endpoint, authenticated by a shared
 * secret — this service is never exposed directly to end users' browsers.
 *
 * Security posture (each one maps to a line in this file, not just a README claim):
 * - isolated execution: this process's only job is compiling LaTeX; it shares no filesystem,
 *   database, or credentials with the main app.
 * - no shell escape: `execFile` with an argv array (never a shell string / `exec`).
 * - no network access from the compile process: `--bundle <local path>` + `--only-cached`
 *   below means `tectonic` itself never makes a network call at request time — the bundle is
 *   baked into the image at build time (see Dockerfile).
 * - strict timeout + resource limits: `execFile`'s own `timeout`/`maxBuffer`; container-level
 *   memory/CPU limits are set at the orchestration layer (documented in README.md — they
 *   can't be self-imposed from inside the container).
 * - temporary filesystem only, deleted after the request: a fresh `mkdtemp` per request,
 *   removed in a `finally` block regardless of outcome.
 * - never logs résumé/LaTeX contents: every log line below is metadata only (byte counts,
 *   duration, outcome) — grep this file for `console.` to audit that claim directly.
 * - authenticated Career OS caller: a constant-time bearer-token check against
 *   `RESUME_COMPILER_TOKEN`.
 * - rate limited: a simple in-process sliding window (see `RATE_LIMIT_PER_MINUTE` below) —
 *   proportionate to "one Career OS deployment, one shared secret" today; a real per-user
 *   limit belongs in the Career OS API route once this is ever multi-tenant, not here.
 * - safe maximum source size: `MAX_SOURCE_BYTES`, checked before writing anything to disk.
 */

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.RESUME_COMPILER_TOKEN;
const BUNDLE_PATH = process.env.TECTONIC_BUNDLE_PATH ?? '/opt/tectonic-bundle';
const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES ?? 200_000);
const COMPILE_TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS ?? 20_000);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30);

if (!TOKEN) {
  console.error('RESUME_COMPILER_TOKEN is required — refusing to start unauthenticated.');
  process.exit(1);
}

// ---- rate limiting: in-process sliding window, one bucket (see doc comment above) ----------
const requestTimestamps: number[] = [];
function isRateLimited(): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < windowStart) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) return true;
  requestTimestamps.push(now);
  return false;
}

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(TOKEN!);
  // timingSafeEqual requires equal-length buffers — a length mismatch is itself safe to
  // short-circuit on (it leaks nothing beyond "wrong length", never the actual secret).
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Best-effort line-number extraction from Tectonic's own stderr (`file.tex:NN: ...`) — never
 * surfaces the raw stderr verbatim to the caller (it can contain temp filesystem paths). */
function extractErrorLine(stderr: string): number | undefined {
  const match = /:(\d+):/.exec(stderr);
  return match?.[1] ? Number(match[1]) : undefined;
}

async function handleCompile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startedAt = Date.now();

  if (!isAuthorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: 'Unauthorized' }),
    );
    return;
  }
  if (isRateLimited()) {
    res.writeHead(429, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: 'Rate limit exceeded — try again shortly.' }),
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_SOURCE_BYTES + 1024); // small slack for JSON framing
  } catch (error) {
    const status = error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    res.writeHead(status, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: status === 413 ? 'Source too large' : 'Malformed request body' }),
    );
    return;
  }

  const latex = (body as { latex?: unknown }).latex;
  if (typeof latex !== 'string' || latex.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: 'Missing "latex" string in request body' }),
    );
    return;
  }
  if (Buffer.byteLength(latex, 'utf8') > MAX_SOURCE_BYTES) {
    res.writeHead(413, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: 'Source too large' }),
    );
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'resume-compile-'));
  try {
    const inputPath = join(workDir, 'input.tex');
    await writeFile(inputPath, latex, 'utf8');

    const { pdfPath, stderr } = await runTectonic(inputPath, workDir);

    if (pdfPath) {
      const pdf = await readFile(pdfPath);
      console.log(
        JSON.stringify({
          outcome: 'ok',
          inputBytes: Buffer.byteLength(latex, 'utf8'),
          outputBytes: pdf.length,
          durationMs: Date.now() - startedAt,
        }),
      );
      res.writeHead(200, { 'content-type': 'application/pdf' }).end(pdf);
      return;
    }

    console.log(
      JSON.stringify({
        outcome: 'compile_error',
        inputBytes: Buffer.byteLength(latex, 'utf8'),
        durationMs: Date.now() - startedAt,
      }),
    );
    res.writeHead(422, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        error: 'LaTeX did not compile — check your custom LaTeX for syntax errors.',
        line: extractErrorLine(stderr),
      }),
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'ETIMEDOUT';
    console.log(
      JSON.stringify({
        outcome: timedOut ? 'timeout' : 'internal_error',
        durationMs: Date.now() - startedAt,
      }),
    );
    res.writeHead(timedOut ? 504 : 500, { 'content-type': 'application/json' }).end(
      JSON.stringify({ error: timedOut ? 'Compilation timed out' : 'Compilation failed' }),
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Invokes `tectonic` with an argv array (never a shell string) against a local, pre-baked
 * bundle. `--only-cached`-style behavior — verify the exact flag name against the pinned
 * Tectonic version's own `--help` output before deploying; this file cannot be exercised
 * against a real `tectonic` binary in the environment that wrote it (no Docker/network
 * access to the upstream project's docs), so treat this argv list as a documented starting
 * point, not a verified-working invocation.
 */
function runTectonic(
  inputPath: string,
  outDir: string,
): Promise<{ pdfPath: string | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'tectonic',
      [inputPath, '--outdir', outDir, '--bundle', BUNDLE_PATH, '--only-cached'],
      { timeout: COMPILE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error?.killed) {
          reject(new Error('ETIMEDOUT'));
          return;
        }
        // A spawn-level failure (e.g. ENOENT — the `tectonic` binary itself is missing or
        // misconfigured) is this service's own fault, never the caller's LaTeX — surfaced as
        // an internal error, not a 422 "your LaTeX is broken" response.
        if (error && typeof error.code === 'string') {
          reject(new Error(`SPAWN_FAILED:${error.code}`));
          return;
        }
        if (error) {
          resolve({ pdfPath: null, stderr });
          return;
        }
        resolve({ pdfPath: join(outDir, 'input.pdf'), stderr });
      },
    );
  });
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'POST' && req.url === '/compile') {
    void handleCompile(req, res);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'listening', port: PORT }));
});

void mkdir(BUNDLE_PATH, { recursive: true }).catch(() => {});
