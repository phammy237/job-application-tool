import { NextResponse } from 'next/server';
import { markOwnApplicationApplied } from '@career-os/database';
import { getUserIdFromExtensionToken } from '../../../../../lib/extension-auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/** Same CORS posture as /api/applications — see that route's doc comment. */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin?.startsWith('chrome-extension://')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

/**
 * The *only* path that ever sets an application's status to APPLIED from the extension —
 * deliberately a separate endpoint from POST /api/applications, never invoked as a side effect
 * of saving or filling (docs/IMPLEMENTATION_PLAN.md Phase 4C: "no fill, save, navigation, or
 * page event automatically marks the application applied"). The popup requires its own explicit
 * confirmation step before ever calling this. Takes no body — there is nothing to decide here
 * beyond "the user just told us, right now, that they applied."
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const { id } = await params;

  try {
    const supabase = createAdminClient();
    const application = await markOwnApplicationApplied(supabase, userId, id);
    return NextResponse.json(
      { applicationId: application.id, status: application.status, appliedAt: application.appliedAt },
      { headers },
    );
  } catch {
    // Not found and not-owned are indistinguishable on purpose — CLAUDE.md: never leak whether
    // a resource exists under another account.
    return NextResponse.json({ error: 'Application not found' }, { status: 404, headers });
  }
}
