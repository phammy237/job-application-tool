import { NextResponse } from 'next/server';
import { updateOwnBackgroundGmailTrackingEnabled } from '@career-os/database';
import { getCurrentUser } from '../../../../lib/auth';
import { isGmailSyncEnabledForUser } from '../../../../lib/gmail-feature-gate';
import { createClient } from '../../../../lib/supabase/server';

/**
 * Toggles the second, narrower opt-in (migration 0046) that lets the scheduled background cron
 * job scan this user's inbox with no app open at all. Enabling requires the base Gmail
 * connection to already be active — refused otherwise, so a user can never land in a state where
 * background tracking is "on" for a Gmail connection that doesn't exist (or has since been
 * disconnected). Disabling has no such requirement — always allowed, so a user can turn this off
 * even if their connection is currently broken.
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

  if (body.enabled) {
    const canEnable = await isGmailSyncEnabledForUser(supabase, user.id);
    if (!canEnable) {
      return NextResponse.json(
        { error: 'Connect Gmail (and enable manual sync) before turning on background tracking' },
        { status: 403 },
      );
    }
  }

  await updateOwnBackgroundGmailTrackingEnabled(supabase, user.id, body.enabled);
  return NextResponse.json({ backgroundGmailTrackingEnabled: body.enabled });
}
