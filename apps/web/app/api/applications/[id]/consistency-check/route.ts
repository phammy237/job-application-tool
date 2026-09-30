import { NextResponse } from 'next/server';
import { evaluateOwnConsistencyFindings, getOwnApplication } from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { getUserIdFromExtensionToken } from '../../../../../lib/extension-auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * GET /api/applications/:id/consistency-check — advisory only (docs/IMPLEMENTATION_PLAN.md Phase
 * 5B.2E). Fresh recomputation on every call, nothing persisted here. This endpoint exists purely
 * for UX — letting the dashboard/extension show findings before the user commits to marking an
 * application applied — and is deliberately **not** authoritative: the real gate is
 * `markOwnApplicationApplied`'s own recomputation at the PATCH mark-applied call a moment later,
 * which never trusts anything this endpoint returned.
 *
 * Two callers, two auth modes: the web app uses its cookie session (same posture as `GET
 * /api/job-snapshots/:id/requirements`), and the extension popup sends its bearer token before
 * its mark-applied confirmation step (same posture as PATCH mark-applied). A request carrying an
 * Authorization header is only ever checked as an extension token — never silently downgraded
 * to the cookie session if the token is invalid.
 */
async function requireCurrentUserId(request: Request): Promise<string | null> {
  if (request.headers.get('authorization')) {
    return getUserIdFromExtensionToken(request);
  }
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/** Same CORS posture as /api/applications — see that route's doc comment. */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin?.startsWith('chrome-extension://')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await requireCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const { id: applicationId } = await params;
  const supabase = createAdminClient();

  const application = await getOwnApplication(supabase, userId, applicationId);
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404, headers });
  }

  const findings = await evaluateOwnConsistencyFindings(supabase, userId, applicationId);
  return NextResponse.json(
    {
      findings,
      blockingCount: findings.filter((f) => f.severity === 'BLOCKING').length,
      warningCount: findings.filter((f) => f.severity === 'WARNING').length,
    },
    { headers },
  );
}
