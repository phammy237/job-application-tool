import { NextResponse } from 'next/server';
import { generateResumeTailoringPlan } from '@career-os/ai';
import { generateResumeTailoringRequestSchema } from '@career-os/shared';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/resume-tailoring — the ONLY call site for
 * generateResumeTailoringPlan in this codebase (docs/IMPLEMENTATION_PLAN.md "Phase 7E"). Same
 * explicit-user-triggered-only, server-re-derives-everything posture as ../interview-prep/route.ts
 * and ../follow-up-draft/route.ts — see those routes' own doc comments for the full rationale,
 * which applies identically here. POST (not GET) because this makes a billed Claude call and
 * consumes the user's AI request quota.
 *
 * No `resumeVersionId` is ever accepted from the request body, and `generateResumeTailoringPlan`
 * has no such parameter either; the base résumé is always the application's CURRENT
 * `workingResumeVersionId`, re-derived server-side on every call (§3/§40). The response is a fully
 * ephemeral proposal: nothing this route or the pipeline it calls ever writes is a résumé version,
 * a working-résumé-version change, or any other persisted résumé/application state (§21/§45) — the
 * only durable trace of a call is the pipeline's own best-effort `ai_usage_events` telemetry row.
 *
 * Phase 7H: the request body is now OPTIONAL and, when present, may carry `{researchMode,
 * companyResearchSnapshotId}` (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §37) — a missing/empty body
 * is still valid and behaves exactly as it always has (`JOB_ONLY`, unchanged 7E behavior). A
 * client-supplied `companyResearchSnapshotId` is never trusted blindly; the pipeline itself
 * re-resolves and ownership/compatibility-checks it before ever building a prompt (§6/§7).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: applicationId } = await params;

  let rawBody: unknown = {};
  const bodyText = await request.text();
  if (bodyText.length > 0) {
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ status: 'invalid_request' }, { status: 400 });
    }
  }
  const parsedBody = generateResumeTailoringRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ status: 'invalid_request' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const result = await generateResumeTailoringPlan(supabase, user.id, {
    applicationId,
    researchMode: parsedBody.data.researchMode,
    companyResearchSnapshotId: parsedBody.data.companyResearchSnapshotId ?? null,
  });

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
    case 'research_snapshot_not_found':
      return NextResponse.json({ status: 'research_snapshot_not_found' });
    case 'stale_company_research':
      return NextResponse.json({ status: 'stale_company_research' });
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
