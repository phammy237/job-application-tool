import { NextResponse } from 'next/server';
import {
  decryptRefreshToken,
  deleteOwnEmailConnection,
  getOwnEmailConnectionWithToken,
  updateOwnGmailIntegrationEnabled,
} from '@career-os/database';
import { revokeToken } from '@career-os/email';
import { getCurrentUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';

/**
 * Revokes the OAuth grant at Google before deleting the local row — not just deleting the row —
 * so a leaked-but-since-disconnected token is inert, not merely forgotten locally
 * (docs/SECURITY_AND_PRIVACY.md §5). Revocation is best-effort (revokeToken never throws); local
 * cleanup proceeds either way. Deleting the row cascades to email_signals via the migration's
 * `on delete cascade`.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const connection = await getOwnEmailConnectionWithToken(supabase, user.id);
  if (!connection) {
    return NextResponse.json({ error: 'No Gmail connection found' }, { status: 404 });
  }

  await revokeToken(decryptRefreshToken(connection.encryptedRefreshToken));
  await deleteOwnEmailConnection(supabase, user.id);
  await updateOwnGmailIntegrationEnabled(supabase, user.id, false);

  return NextResponse.json({ status: 'disconnected' });
}
