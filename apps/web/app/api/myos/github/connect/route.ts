import { NextResponse } from 'next/server';
import {
  deleteOwnGithubConnection,
  getOwnGithubConnection,
  saveGithubAccessToken,
  upsertOwnGithubConnection,
} from '@career-os/database';
import { AuthError, GithubClient, RateLimitError } from '@career-os/myos';
import { githubConnectRequestSchema } from '@career-os/shared';
import { getCurrentUser } from '../../../../../lib/auth';
import { readCappedText } from '../../../../../lib/myos/read-body';
import { createClient } from '../../../../../lib/supabase/server';
import { createAdminClient } from '../../../../../lib/supabase/admin';

const MAX_BODY_BYTES = 4096;

/**
 * Connects (or reconnects) the signed-in user's GitHub account. `token` is optional: without it
 * only public repositories are ever readable. The token is validated against GET /user, must
 * belong to the claimed login, is stored AES-256-GCM encrypted via the service-role client
 * (github_credentials has no RLS policies), and is never echoed back or logged.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await readCappedText(request, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = githubConnectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid GitHub connection request' },
      { status: 400 },
    );
  }
  const { login, token } = parsed.data;

  let githubUserId: number | null = null;
  if (token) {
    try {
      const me = await new GithubClient({ token }).getAuthenticatedUser();
      if (me.login.toLowerCase() !== login.toLowerCase()) {
        return NextResponse.json(
          { error: 'The access token does not belong to that GitHub username' },
          { status: 400 },
        );
      }
      githubUserId = me.id;
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: 'GitHub rejected the access token' },
          { status: 400 },
        );
      }
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          { error: 'GitHub rate limit reached; try again later' },
          { status: 503 },
        );
      }
      // Log the error class only - never the error object, which could carry request context.
      console.error('[career-os] GitHub token validation failed', (error as Error)?.name);
      return NextResponse.json(
        { error: 'Could not validate the token with GitHub' },
        { status: 502 },
      );
    }
  }

  const supabase = await createClient();
  const existing = await getOwnGithubConnection(supabase, user.id);
  const sameLogin = existing?.githubLogin.toLowerCase() === login.toLowerCase();
  if (existing && !sameLogin) {
    // Different account: drop the old connection (cascades to its stored token).
    await deleteOwnGithubConnection(supabase, user.id);
  }

  // The connection row must exist before the token (FK), but has_token is only set to true by
  // saveGithubAccessToken after the encrypted token is durably stored - never before.
  const priorHasToken = Boolean(existing && sameLogin && existing.hasToken);
  const connection = await upsertOwnGithubConnection(supabase, user.id, {
    login,
    hasToken: priorHasToken,
    githubUserId: token ? githubUserId : undefined,
  });
  if (token) {
    try {
      await saveGithubAccessToken(createAdminClient(), user.id, token);
    } catch {
      // Roll back: a connection that claims ownership must not exist without its token.
      if (!existing || !sameLogin) {
        try {
          await deleteOwnGithubConnection(supabase, user.id);
        } catch {
          console.error('[career-os] GitHub connect rollback failed');
        }
      }
      console.error('[career-os] GitHub token could not be stored');
      return NextResponse.json(
        { error: 'Could not store the access token' },
        { status: 500 },
      );
    }
    return NextResponse.json({ connection: { ...connection, hasToken: true } });
  }

  return NextResponse.json({ connection });
}
