import { NextResponse } from 'next/server';
import { generateSuggestion } from '@career-os/ai';
import { generateSuggestionRequestSchema } from '@career-os/shared';
import { getUserIdFromExtensionToken } from '../../../../../lib/extension-auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * Called directly by the extension's popup (Phase 4A), same as /api/jobs/analyze — a
 * chrome-extension:// origin's fetch is cross-origin like any other and gets CORS-blocked
 * without these headers. See that route's corsHeaders doc comment for why reflecting the
 * request's own origin is safe here (the bearer-token check below is the actual authorization
 * boundary; CORS only affects whether a browser lets JS *read* the response).
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
 * Runs retrieval + Claude for one form field and returns a validated suggestion, per
 * docs/IMPLEMENTATION_PLAN.md Phase 3. Extension-token/admin-client auth, matching
 * api/jobs/analyze/route.ts — this route's real caller is the extension's Phase 4A review flow,
 * not a cookie session. All business logic lives in packages/ai; this route only maps
 * generateSuggestion's result union to an HTTP response.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const parsed = generateSuggestionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers });
  }

  const { id: jobId } = await params;
  const supabase = createAdminClient();

  const result = await generateSuggestion(supabase, userId, {
    jobId,
    applicationId: parsed.data.applicationId ?? null,
    fieldLabel: parsed.data.fieldLabel,
    fieldClassification: parsed.data.fieldClassification,
  });

  switch (result.status) {
    case 'generated':
      return NextResponse.json({ status: 'generated', suggestion: result.answer }, { headers });
    case 'job_not_found':
      return NextResponse.json({ error: 'Job not found' }, { status: 404, headers });
    case 'rate_limited':
      return NextResponse.json(
        { error: 'AI request limit reached', usage: result.usage },
        { status: 429, headers },
      );
    case 'provider_error':
      return NextResponse.json({ error: 'AI provider error' }, { status: 502, headers });
    default:
      // not_supported_for_field | insufficient_facts | no_suggestion — all honest "nothing to
      // show" outcomes, not errors; identical response shape so the caller can't distinguish
      // "rejected" from "insufficient facts" and accidentally surface a partial answer.
      return NextResponse.json({ status: result.status }, { headers });
  }
}
