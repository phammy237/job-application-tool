import { NextResponse } from 'next/server';
import { confirmOwnEmailSignal } from '@career-os/database';
import { uuidSchema } from '@career-os/shared';
import { z } from 'zod';
import { getCurrentUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';

const bodySchema = z.object({
  action: z.enum(['CONFIRM', 'DECLINE']),
  applicationId: uuidSchema.optional(),
});

/**
 * The user-confirmation path for a below-threshold match (docs/EMAIL_INTEGRATION.md §1.8) —
 * CONFIRM writes an application_events STATUS_CHANGE row (source GMAIL_SYNC, undoable via the
 * existing revert mechanism) via confirmOwnEmailSignal; DECLINE only marks the signal DECLINED
 * and never touches applications/application_events. Not-found and not-owned are indistinguishable
 * on purpose (CLAUDE.md: never leak whether a resource exists under another account).
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
    const signal = await confirmOwnEmailSignal(supabase, user.id, id, parsed.data);
    return NextResponse.json({ signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm this email signal';
    if (message.includes('not found or not owned')) {
      return NextResponse.json({ error: 'Email signal not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
