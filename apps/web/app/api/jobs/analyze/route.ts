import { NextResponse } from 'next/server';
import {
  createOwnJobFromExtraction,
  getOwnJobBySourceUrl,
  updateOwnJobFromExtraction,
} from '@career-os/database';
import { jobExtractionPayloadSchema } from '@career-os/shared';
import { getUserIdFromExtensionToken } from '../../../../lib/extension-auth';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * Accepts the extension's job-page extraction and stores it as a jobs row — no AI ranking, no
 * field persistence, matching Phase 2's boundary exactly (docs/IMPLEMENTATION_PLAN.md Phase 2).
 * Phase 3 adds retrieval/ranking/Claude on top of the stored job.
 *
 * Authenticated via the extension's bearer token, not a cookie session, so this always uses the
 * admin client — there is no RLS session for this request. Every query below passes the
 * verified userId explicitly (CLAUDE.md: service-role paths must independently filter by
 * user_id — RLS is the backstop here, not the only check, since it's bypassed entirely).
 */
export async function POST(request: Request) {
  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = jobExtractionPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const input = parsed.data;

  const existing = input.sourceUrl
    ? await getOwnJobBySourceUrl(supabase, userId, input.sourceUrl)
    : null;

  const job = existing
    ? await updateOwnJobFromExtraction(supabase, userId, existing.id, input)
    : await createOwnJobFromExtraction(supabase, userId, input);

  return NextResponse.json({ jobId: job.id, created: !existing });
}
