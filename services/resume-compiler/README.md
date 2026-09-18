# Career OS résumé compile service

Standalone LaTeX → PDF compiler for Resume Studio's real preview. Lives **outside** the main
Next.js app and its Vercel deployment, on purpose: a real LaTeX distribution (or even a
single Tectonic binary plus its package bundle) doesn't fit inside a Vercel serverless
function's size limit, and Vercel gives no way to guarantee "the compile process itself never
touches the network" — a hard requirement here, not a nice-to-have.

This directory is **not** part of the root npm workspaces — it has its own build/deploy
lifecycle (a Docker image), and `npm run build/test/lint` at the repo root never touches it.

## Why this shape

- **Isolated execution** — its own container/process, no shared filesystem, database, or
  credentials with the main app. It knows nothing about Supabase, Candidate Profile, or any
  other Career OS concept beyond "here is some LaTeX, give me back a PDF or an error."
- **No shell escape** — `execFile('tectonic', [...argv])` in `src/server.ts`, never a shell
  string. There is nothing for injected LaTeX content to break out into.
- **No network access from the compile process** — the Tectonic package bundle is fetched
  once, at Docker *build* time (see the Dockerfile's "Pre-fetch" step), then every
  request-time compile runs with `--only-cached`, which fails closed instead of reaching out
  if anything is missing from that baked-in bundle.
- **Strict timeout / resource limits** — `execFile`'s own timeout in `server.ts`; container
  memory/CPU/PID limits are set at the orchestration layer (see "Deploying" below) — a
  Dockerfile can't impose a memory ceiling on itself.
- **Temporary filesystem only** — a fresh `mkdtemp()` per request, removed in a `finally`
  block whether the compile succeeds or fails.
- **Never logs résumé/LaTeX contents** — every `console.log` in `server.ts` is metadata only
  (byte counts, duration, outcome). Grep for `console.` to audit that claim directly.
- **Authenticated Career OS caller only** — a shared-secret bearer token
  (`RESUME_COMPILER_TOKEN`), checked with a constant-time comparison. This service is never
  exposed to end users' browsers — only to the Career OS Next.js server, server-to-server.
- **Rate limited** — a simple in-process sliding window (`RATE_LIMIT_PER_MINUTE`). This is
  proportionate to "one Career OS deployment, one shared secret" today, not a per-user limit
  — add one on the Career OS side (`apps/web/app/api/resumes/compile/route.ts`) if/when this
  is ever genuinely multi-tenant.
- **Safe maximum source size** — `MAX_SOURCE_BYTES` (default 200 KB — generous for a résumé),
  checked before anything is written to disk.

## What's *not* built here (documented, not silently skipped)

Per-request sandboxing (each compile in its own ephemeral, fully `--network none` container,
e.g. via Firecracker/gVisor) would be a genuine hardening step beyond this V1. What this
service *does* guarantee — the compile subprocess has no reachable network path regardless —
is a real, sufficient answer to "no network access from the compile process" for a
single-tenant/personal deployment; the ephemeral-sandbox-per-request model is the natural next
step if this ever serves untrusted multi-tenant traffic at scale.

## ⚠️ Not verified against a real build

This was written in a sandboxed environment with no Docker and no access to
`github.com` (only generic web access) — the `tectonic` install URL, its exact release
artifact naming, and the `--only-cached`-equivalent CLI flag in `src/server.ts` are a
documented best-effort starting point based on Tectonic's known CLI shape, **not** a
verified-working build. Before deploying:

1. `docker build -t resume-compiler .` locally and fix whatever the real `tectonic --help`
   disagrees with (flag names do shift between versions — pin `TECTONIC_VERSION` in the
   Dockerfile to whatever you actually verify against).
2. Confirm the bundle pre-fetch step in the Dockerfile actually produces a PDF from the
   trivial warm-up document, and that a *second* compile (simulating a request) succeeds with
   zero network access (e.g. run the container with `--network none` and confirm compiles
   still work).

## Deploying

Fly.io or Railway are the two straightforward options — both take an arbitrary Dockerfile and
let you set per-app memory/CPU limits without standing up your own VM.

Either way, you need:
- `RESUME_COMPILER_TOKEN` — a long random secret, set identically here and as
  `RESUME_COMPILER_TOKEN` on the Career OS (Vercel) side. Never commit it.
- The service's public URL, set as `RESUME_COMPILER_URL` on the Career OS side (e.g.
  `https://resume-compiler.fly.dev`).
- A memory/CPU limit on the deployed instance (Tectonic compiles are lightweight, but the
  container should still never be allowed to consume unbounded resources) — e.g. on Fly.io,
  `[[vm]] memory_mb = 512` / `cpu_kind = "shared"` / `cpus = 1` in `fly.toml`.

Local smoke test once built:

```sh
docker run --rm -p 8080:8080 -e RESUME_COMPILER_TOKEN=dev-secret resume-compiler
curl -X POST http://localhost:8080/compile \
  -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" \
  -d '{"latex":"\\documentclass{article}\\begin{document}hello\\end{document}"}' \
  -o out.pdf
```

## Career OS side

`apps/web/app/api/resumes/compile/route.ts` calls this service when both `RESUME_COMPILER_URL`
and `RESUME_COMPILER_TOKEN` are set in the web app's own environment; when either is unset, it
returns `{ status: 'not_configured' }` and the UI shows an honest "PDF preview isn't
configured yet" state rather than faking one.
