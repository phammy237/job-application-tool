import { NextResponse } from 'next/server';
import {
  getJobCatalogEntryById,
  getJobCatalogFeatures,
  getJobSource,
  getOwnMatchScore,
  startApplicationFromCatalogJob,
} from '@career-os/database';
import { buildCatalogJobHandoffPayload } from '@career-os/discovery';
import { uuidSchema } from '@career-os/shared';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';
import { createClient } from '../../../../../lib/supabase/server';

/**
 * D6's one canonical handoff endpoint (docs/JOB_DISCOVERY.md "Handoff API/action architecture") —
 * `POST /api/discovery/[id]/start-application`, `id` is the `job_catalog.id`. No request body:
 * every field the operation needs is either the path param or server-derived from the verified
 * session and the already-readable catalog/feature/score rows — nothing is trusted from the
 * client beyond "which catalog job."
 *
 * Reads: `job_catalog`/`job_catalog_features` (authenticated-select-all) and the caller's own
 * match score (scoped by their own RLS) use the ordinary session-scoped client — no reason to
 * reach for elevated privileges for those. `job_sources` is the one exception — unlike
 * `job_catalog`, it has *no* `authenticated` SELECT policy at all (migration 0029: "every write
 * happens exclusively through the service-role admin client... no policy at all for job_sources"
 * — read access was never opened either), so a session-scoped read of it silently returns no row,
 * not an error (confirmed live during D6 verification: `sourceType` came back `null` for every
 * real job until this was fixed) — it's read via the admin client instead, alongside the write
 * step that already needs it. `startApplicationFromCatalogJob` itself also needs the admin
 * client, for the structural reason `job_snapshots` has no `authenticated` INSERT policy at all
 * (see migration 0032's own doc comment) — the same posture `upsertApplicationWithSnapshot`
 * already established. `userId` is derived once, from `getCurrentUser()`, and never re-derived
 * from anything client-supplied afterward.
 *
 * No AI/search-provider call anywhere in this path, and no other existing action (resume
 * tailoring, company research, interview prep) is triggered automatically — those remain explicit
 * user actions on the application page itself (docs/JOB_DISCOVERY.md "AI/provider audit").
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid job id.' }, { status: 400 });
  }
  const jobCatalogId = parsedId.data;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const job = await getJobCatalogEntryById(supabase, jobCatalogId);
  if (!job) {
    return NextResponse.json({ error: 'This job could not be found.' }, { status: 404 });
  }

  // Catalog status (ACTIVE/POSSIBLY_CLOSED/CLOSED) is deliberately never a gate here — a user may
  // still want to track/record a job that closed moments ago (docs/JOB_DISCOVERY.md "Catalog
  // lifecycle behavior" has the full reasoning); only "does this catalog row exist at all" is
  // validated, both here and again inside the RPC itself.

  const [features, jobSource, matchScore] = await Promise.all([
    getJobCatalogFeatures(supabase, jobCatalogId),
    getJobSource(admin, job.sourceId),
    getOwnMatchScore(supabase, user.id, jobCatalogId),
  ]);

  // Snapshot/fingerprint/metadata/canonical-url building lives in packages/discovery's
  // buildCatalogJobHandoffPayload (extracted for D9 Phase A so the Auto Mode cron orchestrator
  // builds the identical payload a manual click would, never a second, drifting copy) — see that
  // function's own doc comment for why each field is derived the way it is, including the
  // post-D7.1 `selectCanonicalHandoffUrl` fix for Jobright's unresolved detail-page URLs.
  const payload = await buildCatalogJobHandoffPayload({ job, features, jobSource, matchScore });

  try {
    const result = await startApplicationFromCatalogJob(admin, user.id, {
      jobCatalogId,
      ...payload,
    });

    return NextResponse.json({
      applicationId: result.applicationId,
      created: result.created,
      status: result.status,
    });
  } catch (error) {
    console.error('[career-os] discovery handoff failed', error);
    return NextResponse.json(
      { error: 'Could not start this application. Please try again.' },
      { status: 502 },
    );
  }
}
