import { NextResponse } from 'next/server';
import {
  getOwnApplication,
  getOwnSubmissionPacketByApplicationId,
} from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * "What does Career OS actually have recorded about what I submitted?" — the read path behind
 * the application detail page's submission viewer (docs/IMPLEMENTATION_PLAN.md Phase 5B.4). A
 * cookie-session-authenticated web route, same posture as
 * apps/web/app/api/job-snapshots/[id]/requirements/route.ts: getCurrentUser derives the id from
 * the verified Supabase session, never a client-supplied field.
 */
async function requireCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/**
 * `packet: null` is a legitimate, honest 200 response — either the application isn't APPLIED
 * yet, or it's a legacy APPLIED row that predates packet support (docs/IMPLEMENTATION_PLAN.md
 * Phase 5B.1G) — never treated as an error. Only a nonexistent/not-owned *application* is a 404,
 * and that case is indistinguishable from "not found" on purpose (CLAUDE.md: never leak whether
 * a resource exists under another account).
 */
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

  const packet = await getOwnSubmissionPacketByApplicationId(
    supabase,
    userId,
    applicationId,
  );
  return NextResponse.json({ packet });
}
