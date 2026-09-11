import { NextResponse } from 'next/server';
import { evaluateOwnConsistencyFindings, getOwnApplication } from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * GET /api/applications/:id/consistency-check — advisory only (docs/IMPLEMENTATION_PLAN.md Phase
 * 5B.2E). Fresh recomputation on every call, nothing persisted here. This endpoint exists purely
 * for UX — letting the dashboard/extension show findings before the user commits to marking an
 * application applied — and is deliberately **not** authoritative: the real gate is
 * `markOwnApplicationApplied`'s own recomputation at the PATCH mark-applied call a moment later,
 * which never trusts anything this endpoint returned. Same cookie-session auth posture as `GET
 * /api/job-snapshots/:id/requirements` and `GET /api/applications/:id/packet`.
 */
async function requireCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: applicationId } = await params;
  const supabase = createAdminClient();

  const application = await getOwnApplication(supabase, userId, applicationId);
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  const findings = await evaluateOwnConsistencyFindings(supabase, userId, applicationId);
  return NextResponse.json({
    findings,
    blockingCount: findings.filter((f) => f.severity === 'BLOCKING').length,
    warningCount: findings.filter((f) => f.severity === 'WARNING').length,
  });
}
