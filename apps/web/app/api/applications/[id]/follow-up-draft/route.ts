import { NextResponse } from 'next/server';
import { generateFollowUpDraft } from '@career-os/ai';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * POST /api/applications/:id/follow-up-draft — the ONLY call site for generateFollowUpDraft in
 * this codebase (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3A"). Explicit user-triggered only: no
 * caller anywhere else invokes this route automatically — not on dashboard load, not on
 * application page load, not on a threshold being reached, not on Gmail sync, not on every status
 * update, not from the extension popup, not from a background job. POST (not GET) because this
 * makes a billed Claude call and consumes the user's AI request quota.
 *
 * No `actionType` is ever accepted from the request body — there is no request body at all. The
 * only input is the application id in the URL; `generateFollowUpDraft` independently re-derives
 * the current deterministic next action and refuses (`action_not_current`) if it is not
 * CONSIDER_FOLLOW_UP, so a stale client can never force a draft for an action that is no longer
 * current. Ownership is enforced by the same query every other route in this codebase uses
 * (`getOwnApplication`, scoped by the verified session's userId) — a not-owned or nonexistent
 * application id look identical here (`application_not_found`), never distinguished, so this
 * route can never be used to probe for the existence of another user's application.
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

  const result = await generateFollowUpDraft(supabase, user.id, { applicationId });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ status: 'ok', draft: result.draft });
    case 'application_not_found':
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    case 'action_not_current':
      return NextResponse.json({
        status: 'action_not_current',
        currentActionType: result.currentActionType,
      });
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
