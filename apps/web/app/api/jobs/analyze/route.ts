import { NextResponse } from 'next/server';
import {
  createOwnJobFromExtraction,
  getOwnJobBySourceUrl,
  updateOwnJobFromExtraction,
} from '@career-os/database';
import { jobExtractionPayloadSchema } from '@career-os/shared';
import { getUserIdFromExtensionToken } from '../../../../lib/extension-auth';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * The only route the extension's popup calls directly (not via a same-origin page), so it's the
 * only one that needs CORS handling — a browser extension's fetch from a chrome-extension://
 * origin is cross-origin like any other, and gets CORS-blocked without these headers. Reflecting
 * the request's own chrome-extension:// origin back (rather than a static allowlist entry) means
 * this doesn't need updating if the extension's dev key/ID ever changes, and a regular web page
 * cannot spoof a chrome-extension:// Origin header — that's browser-enforced, not JS-settable.
 * The endpoint's real authorization is the bearer token check below regardless of origin; CORS
 * here only affects whether a browser lets JS *read* the response, not who can reach the server.
 */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin?.startsWith('chrome-extension://')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

/**
 * Accepts the extension's job-page extraction and stores it as a jobs row — no AI ranking, no
 * field persistence, matching Phase 2's boundary exactly (docs/IMPLEMENTATION_PLAN.md Phase 2).
 * Phase 3 adds retrieval/ranking/Claude on top of the stored job.
 *
 * Authenticated via the extension's bearer token, not a cookie session, so this always uses the
 * admin client — there is no RLS session for this request. Every query below passes the
 * verified userId explicitly (CLAUDE.md: service-role paths must independently filter by
 * user_id — RLS is the backstop here, not the only check, since it's bypassed entirely).
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const parsed = jobExtractionPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers });
  }

  const supabase = createAdminClient();
  const input = parsed.data;

  const existing = input.sourceUrl
    ? await getOwnJobBySourceUrl(supabase, userId, input.sourceUrl)
    : null;

  const job = existing
    ? await updateOwnJobFromExtraction(supabase, userId, existing.id, input)
    : await createOwnJobFromExtraction(supabase, userId, input);

  return NextResponse.json({ jobId: job.id, created: !existing }, { headers });
}
