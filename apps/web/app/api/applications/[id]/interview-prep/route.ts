import { NextResponse } from 'next/server';
import { generateInterviewPrep } from '@career-os/ai';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/interview-prep — the ONLY call site for generateInterviewPrep in
 * this codebase (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3B"). Same explicit-user-triggered-only,
 * no-request-body, server-re-derives-eligibility posture as
 * ../follow-up-draft/route.ts's own doc comment — see that route for the full rationale, which
 * applies identically here except the eligible action is PREPARE_INTERVIEW rather than
 * CONSIDER_FOLLOW_UP.
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

  const result = await generateInterviewPrep(supabase, user.id, { applicationId });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ status: 'ok', prep: result.prep });
    case 'application_not_found':
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    case 'action_not_current':
      return NextResponse.json({
        status: 'action_not_current',
        currentActionType: result.currentActionType,
      });
    case 'insufficient_context':
      return NextResponse.json({ status: 'insufficient_context' });
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
