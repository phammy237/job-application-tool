import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';

export const maxDuration = 30;

const MAX_SOURCE_BYTES = 200_000;

// Best-effort, per-instance rate limit — Vercel serverless functions don't share memory
// across invocations, so this is a soft guard, not a real distributed limiter. A persisted
// per-user counter (same pattern as ai_request_usage) is the correct fix once this is
// genuinely multi-tenant; disproportionate to add for a UI polish pass serving one real user
// today, so deliberately deferred (see services/resume-compiler/README.md's own rate-limit
// note for the equivalent call there, which is the one that actually matters right now).
const requestTimestampsByUser = new Map<string, number[]>();
const RATE_LIMIT_PER_MINUTE = 20;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (requestTimestampsByUser.get(userId) ?? []).filter((t) => t >= windowStart);
  if (timestamps.length >= RATE_LIMIT_PER_MINUTE) {
    requestTimestampsByUser.set(userId, timestamps);
    return true;
  }
  timestamps.push(now);
  requestTimestampsByUser.set(userId, timestamps);
  return false;
}

/**
 * The one web-side hop between Resume Studio and the standalone compiler service
 * (services/resume-compiler/ — deployed separately, never inside this Vercel app; see that
 * package's README for why). Stateless — compiles whatever LaTeX the client currently has in
 * memory, never a saved résumé version directly, matching Resume Studio's existing
 * "everything here is an unsaved draft" model. When the compiler service isn't configured
 * (`RESUME_COMPILER_URL`/`RESUME_COMPILER_TOKEN` unset — true for every environment today,
 * since nothing has been deployed yet), this returns an honest `not_configured` status; the
 * UI shows that plainly rather than faking a preview. Never logs the LaTeX body.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const compilerUrl = process.env.RESUME_COMPILER_URL;
  const compilerToken = process.env.RESUME_COMPILER_TOKEN;
  if (!compilerUrl || !compilerToken) {
    return NextResponse.json({ status: 'not_configured' }, { status: 200 });
  }

  if (isRateLimited(user.id)) {
    return NextResponse.json(
      { status: 'rate_limited', error: "You've made a lot of preview requests — try again shortly." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const latex = (body as { latex?: unknown } | null)?.latex;
  if (typeof latex !== 'string' || latex.length === 0) {
    return NextResponse.json({ error: 'Missing LaTeX source.' }, { status: 400 });
  }
  if (Buffer.byteLength(latex, 'utf8') > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: 'This résumé source is too large to preview.' }, { status: 413 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${compilerUrl.replace(/\/$/, '')}/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${compilerToken}`,
      },
      body: JSON.stringify({ latex }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.error('[career-os] resume compile service unreachable', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: 'error', error: 'The preview service is temporarily unavailable — please try again shortly.' },
      { status: 502 },
    );
  }

  if (upstream.status === 200) {
    const pdf = await upstream.arrayBuffer();
    return new NextResponse(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  }

  const upstreamBody = (await upstream.json().catch(() => null)) as
    | { error?: string; line?: number }
    | null;

  if (upstream.status === 422) {
    return NextResponse.json(
      {
        status: 'compile_error',
        error: upstreamBody?.error ?? 'This LaTeX did not compile.',
        line: upstreamBody?.line,
      },
      { status: 422 },
    );
  }
  if (upstream.status === 413) {
    return NextResponse.json({ status: 'error', error: 'This résumé source is too large to preview.' }, { status: 413 });
  }
  if (upstream.status === 429) {
    return NextResponse.json(
      { status: 'rate_limited', error: "You've made a lot of preview requests — try again shortly." },
      { status: 429 },
    );
  }

  // Never forward the upstream service's raw error text — it can describe its own internal
  // state (e.g. a spawn failure) that a Career OS user has no use for and shouldn't see.
  return NextResponse.json(
    { status: 'error', error: 'Could not generate a preview right now — please try again shortly.' },
    { status: 502 },
  );
}
