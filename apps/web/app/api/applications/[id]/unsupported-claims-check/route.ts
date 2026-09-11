import { NextResponse } from 'next/server';
import { getOwnApplication } from '@career-os/database';
import { generateUnsupportedClaimsCheck } from '@career-os/ai';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/unsupported-claims-check — the ONLY call site for
 * generateUnsupportedClaimsCheck in this codebase (docs/IMPLEMENTATION_PLAN.md Phase 5B.3).
 * Explicit user-triggered only: no caller anywhere else invokes this route or the underlying
 * pipeline automatically — not on page load, not on extension popup open, not from the
 * deterministic GET /consistency-check, not on every answer edit, not from Mark Applied, not
 * from a background job, not from Gmail sync. POST (not GET) because unlike the deterministic
 * consistency check, this makes a billed Claude call and consumes the user's AI request quota —
 * it must never fire as a side effect of an idempotent read.
 *
 * Always advisory: findings this endpoint returns are never fed into markOwnApplicationApplied's
 * acknowledgedFindingIds gate, and every finding it can produce is WARNING severity (enforced
 * inside generateUnsupportedClaimsCheck itself, not just here). A provider failure, rate limit,
 * or insufficient data is reported as "unavailable"/"nothing to check" at HTTP 200 rather than an
 * error status — this check can never block or fail the user's ability to submit, so the response
 * shape reflects that: only a real auth/ownership failure is a non-200.
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

  const application = await getOwnApplication(supabase, user.id, applicationId);
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  const result = await generateUnsupportedClaimsCheck(supabase, user.id, { applicationId });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ status: 'ok', findings: result.findings });
    case 'no_answers_to_check':
    case 'insufficient_facts':
      return NextResponse.json({ status: 'no_claims_to_check', reason: result.status, findings: [] });
    case 'rate_limited':
      return NextResponse.json({ status: 'unavailable', reason: 'rate_limited', findings: [] });
    case 'provider_error':
    case 'validation_failed':
      return NextResponse.json({ status: 'unavailable', reason: result.status, findings: [] });
    default: {
      const exhaustiveCheck: never = result;
      return exhaustiveCheck;
    }
  }
}
