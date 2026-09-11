import { NextResponse } from 'next/server';
import {
  ConsistencyCheckFailedError,
  markOwnApplicationApplied,
} from '@career-os/database';
import { markAppliedRequestSchema } from '@career-os/shared';
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
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

/**
 * The *only* path that ever sets an application's status to APPLIED from the extension —
 * deliberately a separate endpoint from POST /api/applications, never invoked as a side effect
 * of saving or filling (docs/IMPLEMENTATION_PLAN.md Phase 4C: "no fill, save, navigation, or
 * page event automatically marks the application applied"). The popup requires its own explicit
 * confirmation step before ever calling this.
 *
 * As of Phase 5B.2, the body is optional but may carry `{ acknowledgedFindingIds }` — the ids of
 * currently-shown WARNING findings the user explicitly acknowledged in a prior GET
 * /consistency-check review. A missing/empty body defaults to no acknowledgements, which is
 * exactly correct for a clean application. This route never trusts the body for anything beyond
 * those ids — findings/severity/values are always recomputed authoritatively inside
 * markOwnApplicationApplied itself, never accepted from the client (docs/IMPLEMENTATION_PLAN.md
 * Phase 5B.2F: "GET is advisory, PATCH is authoritative").
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const { id } = await params;
  const bodyJson = await request.json().catch(() => ({}));
  const parsed = markAppliedRequestSchema.safeParse(bodyJson);
  const acknowledgedFindingIds = parsed.success ? parsed.data.acknowledgedFindingIds : [];

  try {
    const supabase = createAdminClient();
    const application = await markOwnApplicationApplied(supabase, userId, id, {
      acknowledgedFindingIds,
    });
    return NextResponse.json(
      {
        applicationId: application.id,
        status: application.status,
        appliedAt: application.appliedAt,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof ConsistencyCheckFailedError) {
      return NextResponse.json(
        {
          status: 'consistency_check_failed',
          reason: error.reason,
          findings: error.findings,
          blockingCount: error.findings.filter((f) => f.severity === 'BLOCKING').length,
          warningCount: error.findings.filter((f) => f.severity === 'WARNING').length,
        },
        { status: 409, headers },
      );
    }
    // Not found and not-owned are indistinguishable on purpose — CLAUDE.md: never leak whether
    // a resource exists under another account.
    return NextResponse.json(
      { error: 'Application not found' },
      { status: 404, headers },
    );
  }
}
