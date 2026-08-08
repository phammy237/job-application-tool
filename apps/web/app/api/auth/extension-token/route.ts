import { NextResponse } from 'next/server';
import {
  createOwnExtensionSession,
  generateExtensionToken,
  hashExtensionToken,
} from '@career-os/database';
import { z } from 'zod';
import { getCurrentUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';

const ROLLING_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  deviceLabel: z.string().max(200).nullable().optional(),
});

/**
 * Mints a new extension-scoped bearer token for the currently logged-in web session
 * (docs/EXTENSION_DESIGN.md §4). Cookie-authenticated via getCurrentUser() directly rather than
 * requireUser(), which redirects on failure — wrong for a route handler that must return 401
 * JSON to a fetch() caller, not a redirect a browser navigation could follow.
 *
 * Uses the cookie-scoped (RLS) client, not the admin client: a real session already exists
 * here, so RLS naturally covers the insert — no need to reach for the service-role client.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const token = generateExtensionToken();
  const expiresAt = new Date(Date.now() + ROLLING_EXPIRY_MS).toISOString();

  const supabase = await createClient();
  const session = await createOwnExtensionSession(supabase, user.id, {
    tokenHash: hashExtensionToken(token),
    deviceLabel: parsed.data.deviceLabel ?? null,
    expiresAt,
  });

  return NextResponse.json({ ...session, token });
}
