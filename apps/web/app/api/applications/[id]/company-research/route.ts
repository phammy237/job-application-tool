import { NextResponse } from 'next/server';
import { generateCompanyResearch } from '@career-os/ai';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/company-research — the ONLY call site for
 * generateCompanyResearch in this codebase (docs/IMPLEMENTATION_PLAN.md "Phase 7G"). Same
 * explicit-user-triggered-only, no-request-body, server-re-derives-everything posture as
 * ../resume-tailoring/route.ts — see that route's own doc comment for the full rationale, which
 * applies identically here. POST (not GET) because this makes a billed Claude call (plus one or
 * more search-provider calls) and consumes the user's AI request quota.
 *
 * No `company`/`roleTitle` is ever accepted from the request body — there is no request body at
 * all, and `generateCompanyResearch` has no such parameter either; company/role are always the
 * application's CURRENT `company`/`title` fields, re-derived server-side on every call. RESEARCH
 * ONLY: this route never creates/changes a résumé version, never touches
 * `working_resume_version_id`, and never regenerates interview prep.
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

  const result = await generateCompanyResearch(supabase, user.id, { applicationId });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ status: 'ok', snapshot: result.snapshot });
    case 'application_not_found':
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    case 'rate_limited':
      return NextResponse.json(
        { error: 'AI request limit reached', usage: result.usage },
        { status: 429 },
      );
    case 'research_provider_unavailable':
    case 'no_useful_sources':
    case 'insufficient_source_evidence':
    case 'stale_application_context':
      return NextResponse.json({ status: result.status });
    case 'search_provider_error':
      return NextResponse.json(
        { status: result.status, error: result.message },
        { status: 502 },
      );
    case 'ai_provider_unavailable':
      return NextResponse.json(
        { status: result.status, error: result.message },
        { status: 502 },
      );
    case 'invalid_research_output':
      return NextResponse.json({ status: result.status }, { status: 502 });
    default: {
      const exhaustiveCheck: never = result;
      return exhaustiveCheck;
    }
  }
}
