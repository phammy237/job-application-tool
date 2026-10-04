import { NextResponse } from 'next/server';
import { resolveOwnAutoQueuedApplication } from '@career-os/database';
import { z } from 'zod';
import { getCurrentUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';

const bodySchema = z.object({
  action: z.enum(['KEEP', 'DISMISS']),
});

/**
 * The user's Keep/Dismiss decision on one Auto Mode-queued application (migration 0047, D9 Phase
 * A) — structural copy of `/api/email-signals/[id]/confirm/route.ts`. KEEP leaves `status` at
 * `SAVED` (it becomes a completely ordinary tracked application from this point on); DISMISS sets
 * `WITHDRAWN` via the existing `changeOwnApplicationStatus`. Session-scoped client, not admin —
 * RLS already scopes every read/write to the caller. Not-found and not-owned (and "already
 * resolved") are indistinguishable on purpose (CLAUDE.md: never leak whether a resource exists
 * under another account).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await createClient();

  try {
    const application = await resolveOwnAutoQueuedApplication(supabase, user.id, id, parsed.data.action);
    return NextResponse.json({ application });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve this application';
    if (message.includes('not found or not owned')) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
