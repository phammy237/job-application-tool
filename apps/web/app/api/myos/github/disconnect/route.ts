import { NextResponse } from 'next/server';
import { deleteOwnGithubConnection, getOwnGithubConnection } from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';

/**
 * Deletes the connection row; github_credentials (the encrypted token) is removed by the
 * `on delete cascade` FK. Already-synced repositories and evidence are intentionally kept —
 * they are the user's data; they can delete them separately.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = await createClient();
  const connection = await getOwnGithubConnection(supabase, user.id);
  if (!connection) {
    return NextResponse.json({ error: 'No GitHub connection found' }, { status: 404 });
  }
  await deleteOwnGithubConnection(supabase, user.id);
  return NextResponse.json({ status: 'disconnected' });
}
