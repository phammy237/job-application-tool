import { NextResponse } from 'next/server';
import { generateResumeTailoringPlan } from '@career-os/ai';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/resume-tailoring — the ONLY call site for
 * generateResumeTailoringPlan in this codebase (docs/IMPLEMENTATION_PLAN.md "Phase 7E"). Same
 * explicit-user-triggered-only, no-request-body, server-re-derives-everything posture as
 * ../interview-prep/route.ts and ../follow-up-draft/route.ts — see those routes' own doc comments
 * for the full rationale, which applies identically here. POST (not GET) because this makes a
 * billed Claude call and consumes the user's AI request quota.
 *
 * No `resumeVersionId` is ever accepted from the request body — there is no request body at all,
 * and `generateResumeTailoringPlan` has no such parameter either; the base résumé is always the
 * application's CURRENT `workingResumeVersionId`, re-derived server-side on every call (§3/§40).
 * The response is a fully ephemeral proposal: nothing this route or the pipeline it calls ever
 * writes is a résumé version, a working-résumé-version change, or any other persisted résumé/
 * application state (§21/§45) — the only durable trace of a call is the pipeline's own best-effort
 * `ai_usage_events` telemetry row.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: applicationId } = await params;
  const supabase = createAdminClient();

  const result = await generateResumeTailoringPlan(supabase, user.id, { applicationId });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ status: 'ok', proposal: result.proposal });
    case 'application_not_found':
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    case 'no_working_resume':
      return NextResponse.json({ status: 'no_working_resume' });
    case 'unsupported_resume_format':
      return NextResponse.json({ status: 'unsupported_resume_format' });
    case 'missing_job_snapshot':
      return NextResponse.json({ status: 'missing_job_snapshot' });
    case 'rate_limited':
      return NextResponse.json(
        { error: 'AI request limit reached', usage: result.usage },
        { status: 429 },
      );
    case 'provider_error':
      return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    case 'validation_failed':
      return NextResponse.json({ status: 'validation_failed' }, { status: 502 });
    default: {
      const exhaustiveCheck: never = result;
      return exhaustiveCheck;
    }
  }
}
