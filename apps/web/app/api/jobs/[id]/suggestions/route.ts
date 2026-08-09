import { NextResponse } from 'next/server';
import { generateSuggestion } from '@career-os/ai';
import { generateSuggestionRequestSchema } from '@career-os/shared';
import { getUserIdFromExtensionToken } from '../../../../../lib/extension-auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * Runs retrieval + Claude for one form field and returns a validated suggestion, per
 * docs/IMPLEMENTATION_PLAN.md Phase 3. Extension-token/admin-client auth, matching
 * api/jobs/analyze/route.ts — this route's real caller is the extension's (Phase 4) autofill
 * flow, not a cookie session. All business logic lives in packages/ai; this route only maps
 * generateSuggestion's result union to an HTTP response.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = generateSuggestionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
      return NextResponse.json({ status: 'generated', suggestion: result.answer });
    case 'job_not_found':
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    case 'rate_limited':
      return NextResponse.json(
        { error: 'AI request limit reached', usage: result.usage },
        { status: 429 },
      );
    case 'provider_error':
      return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    default:
      // not_supported_for_field | insufficient_facts | no_suggestion — all honest "nothing to
      // show" outcomes, not errors; identical response shape so the caller can't distinguish
      // "rejected" from "insufficient facts" and accidentally surface a partial answer.
      return NextResponse.json({ status: result.status });
  }
}
