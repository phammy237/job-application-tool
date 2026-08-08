import { NextResponse } from 'next/server';
import { revokeOwnExtensionSession } from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';

/** Revokes one of the caller's own extension sessions. Cookie-authenticated, same reasoning as
 * the sibling POST route: getCurrentUser() directly, not requireUser(), since this must return
 * 401 JSON rather than redirect. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();
  await revokeOwnExtensionSession(supabase, user.id, id);

  return NextResponse.json({ revoked: true });
}
