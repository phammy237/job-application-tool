import { NextResponse } from 'next/server';
import { runGmailSync } from '@career-os/email';
import { getCurrentUser } from '../../../../lib/auth';
import { isGmailSyncEnabledForUser } from '../../../../lib/gmail-feature-gate';
import { createClient } from '../../../../lib/supabase/server';

/** Bounds worst-case request duration — see docs/IMPLEMENTATION_PLAN.md's sync-route design
 * decision. No background jobs/streaming: manual, click-triggered, one page of messages per
 * click, by design. */
export const maxDuration = 60;

/**
 * No request body — the caller's own connection (looked up server-side) is the only input.
 * Returns 200 even when the sync's own `errors` array is non-empty (a partial failure on some
 * messages is still a successful sync overall, surfaced to the UI as a warning, not treated as a
 * failed request) — only a hard failure to even start syncing (no connection, or an unrecoverable
 * refresh-token error) returns a non-2xx status.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const enabled = await isGmailSyncEnabledForUser(supabase, user.id);
  if (!enabled) {
    return NextResponse.json({ error: 'Gmail sync is not enabled for this account' }, { status: 403 });
  }

  try {
    const result = await runGmailSync(supabase, user.id);
    if (result.status === 'no_connection') {
      return NextResponse.json({ error: 'No Gmail connection found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[career-os] Gmail sync failed', error);
    return NextResponse.json({ error: 'Gmail sync failed — the connection may need to be reconnected' }, { status: 502 });
  }
}
