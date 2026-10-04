import { createHash } from 'node:crypto';
import {
  getOwnPortfolioSettings,
  getUserIdForPortfolioApiKey,
  loadOwnEvidenceGraph,
} from '@career-os/database';
import { buildPortfolioExport, portfolioExportSchema } from '@career-os/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { checkRateLimit } from '../rate-limit';

/**
 * GET /api/portfolio/v1 — read-only public portfolio export (docs/myos/PORTFOLIO_API.md).
 *
 * Auth: `Authorization: Bearer cos_pub_…`. The user id is derived ONLY from the key hash — never
 * from the query string, body or headers other than the bearer token. The service-role client is
 * used, so every read below is explicitly scoped to that derived user id (CLAUDE.md), and the data
 * then passes through the pure `buildPortfolioExport` filter (PUBLIC + user_approved only).
 *
 * Every authentication failure (missing/malformed header, unknown key, rotated key, export
 * disabled) returns the identical 401 body so the endpoint cannot be used to enumerate keys or
 * accounts. No cookies are read; no CORS headers are set (server-to-server only).
 */

export const dynamic = 'force-dynamic';

const UNAUTHORIZED_BODY = { error: 'unauthorized' } as const;
const IP_LIMIT = 120; // requests per minute per client IP (any key)
const KEY_LIMIT = 60; // requests per minute per key+IP
const WINDOW_MS = 60_000;

function unauthorized(): NextResponse {
  return NextResponse.json(UNAUTHORIZED_BODY, {
    status: 401,
    headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
  });
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(`ip:${ip}`, IP_LIMIT, WINDOW_MS);
  const key = parseBearer(request.headers.get('authorization'));
  const keyLimit = key
    ? checkRateLimit(
        `key:${createHash('sha256').update(key).digest('hex').slice(0, 16)}:${ip}`,
        KEY_LIMIT,
        WINDOW_MS,
      )
    : { allowed: true, retryAfterSeconds: 0 };
  if (!ipLimit.allowed || !keyLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(Math.max(ipLimit.retryAfterSeconds, keyLimit.retryAfterSeconds)),
        },
      },
    );
  }

  if (!key) return unauthorized();

  try {
    const admin = createAdminClient();
    const userId = await getUserIdForPortfolioApiKey(admin, key);
    if (!userId) return unauthorized();

    // Both reads are filtered by the key-derived userId (service role bypasses RLS).
    const [graph, settings] = await Promise.all([
      loadOwnEvidenceGraph(admin, userId),
      getOwnPortfolioSettings(admin, userId),
    ]);
    // Re-check at read time: the key lookup already requires enabled=true, but fail closed.
    if (!settings || !settings.enabled) return unauthorized();

    const body = portfolioExportSchema.parse(
      buildPortfolioExport(
        graph,
        { displayName: settings.displayName, headline: settings.headline },
        new Date(),
      ),
    );
    return NextResponse.json(body, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[career-os] portfolio export failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
