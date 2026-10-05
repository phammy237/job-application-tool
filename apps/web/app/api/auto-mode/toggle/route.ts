import { NextResponse } from 'next/server';
import { updateOwnAutoModeEnabled } from '@career-os/database';
import { getCurrentUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';

/**
 * Toggles Auto Mode (migration 0047, D9 Phase A) — the opt-in that lets the scheduled
 * /api/cron/auto-queue job auto-queue this user's own high-Match/high-Coverage/non-CONFLICT
 * /discover candidates as ordinary SAVED applications for review. Unlike background Gmail
 * tracking, there is no prerequisite connection to check — both enable and disable are always
 * allowed.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Request body must include a boolean "enabled" field' }, {
      status: 400,
    });
  }

  const supabase = await createClient();
  await updateOwnAutoModeEnabled(supabase, user.id, body.enabled);
  return NextResponse.json({ autoModeEnabled: body.enabled });
}
