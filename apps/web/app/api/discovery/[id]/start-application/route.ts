import { NextResponse } from 'next/server';
import {
  getJobCatalogEntryById,
  getJobCatalogFeatures,
  getJobSource,
  getOwnMatchScore,
  startApplicationFromCatalogJob,
} from '@career-os/database';
import {
  computeJobSnapshotFingerprint,
  discoveryHandoffEventMetadataSchema,
  sanitizeJobSnapshotInput,
  selectCanonicalHandoffUrl,
  uuidSchema,
  type JobSnapshotSanitizableInput,
} from '@career-os/shared';
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

  // Snapshot content comes only from canonical catalog/feature data — never from Match/Coverage/
  // Eligibility, which are historical provenance (captured separately, below) and never part of
  // the application's own snapshot record (docs/JOB_DISCOVERY.md "Match/Coverage/Eligibility
  // treatment"). `skills` stays empty: job_catalog_features' extractedCompetencyCodes are internal
  // matching codes, not human-readable skill strings the way this field is used elsewhere.
  const sanitizable: JobSnapshotSanitizableInput = {
    company: job.companyName,
    title: job.title,
    location: job.locationText,
    employmentType: job.employmentType,
    sourceUrl: job.sourceUrl ?? job.applyUrl,
    externalId: null,
    description: job.description,
    requiredQualifications: job.qualifications ? [job.qualifications] : [],
    preferredQualifications: [],
    responsibilities: job.responsibilities ? [job.responsibilities] : [],
    skills: [],
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    locations: job.locationText ? [job.locationText] : [],
    workMode:
      features && features.normalizedWorkplaceType !== 'UNKNOWN'
        ? features.normalizedWorkplaceType
        : null,
    remoteLocationRestrictions: null,
    workAuthorizationLanguage: null,
    sourceType: jobSource?.sourceType ?? null,
  };

  const { sanitized, contentTruncated, truncatedFields } = sanitizeJobSnapshotInput(sanitizable);
  const contentFingerprint = await computeJobSnapshotFingerprint(sanitized, {
    contentTruncated,
    truncatedFields,
  });

  // Historical Match/Coverage/Eligibility provenance — a snapshot of what discovery showed at the
  // moment of handoff, stored only as DISCOVERY_HANDOFF event metadata (never on the application
  // row itself, never anything a later read treats as live/authoritative). Null when the job
  // hasn't been scored for this user yet, never fabricated.
  const eventMetadata = discoveryHandoffEventMetadataSchema.parse({
    jobCatalogId,
    sourceType: jobSource?.sourceType ?? null,
    matchScore: matchScore?.matchScore ?? null,
    coverage: matchScore?.coverage ?? null,
    eligibilityStatus: matchScore?.eligibilityStatus ?? null,
    rankingVersion: matchScore?.rankingVersion ?? null,
    featureVersion: matchScore?.featureVersion ?? null,
    eligibilityVersion: matchScore?.eligibilityVersion ?? null,
  });

  // Bug fix (post-D7.1) — `job.canonicalApplyUrl` is raw catalog data, not a confirmed apply
  // destination. Without this, an unresolved/REVIEW/UNRESOLVED Jobright row whose
  // canonical_apply_url still (or again) holds the Jobright detail URL would get snapshotted onto
  // the application as its "canonical employer posting" — exactly the bug this endpoint must not
  // reproduce. `selectCanonicalHandoffUrl` (packages/shared, next to the Discover UI's own
  // `selectJobApplyActions`) is the one named place this handoff-specific precedence decision
  // lives, so this route and the Discover UI can never silently drift apart on what counts as a
  // confirmed-bad URL — see that function's own doc comment for why it's deliberately narrower
  // than `selectJobApplyActions`'s stricter EMPLOYER_DOMAIN/ACCEPTED_ATS allowlist.
  const canonicalUrl = selectCanonicalHandoffUrl(job.canonicalApplyUrl);

  try {
    const result = await startApplicationFromCatalogJob(admin, user.id, {
      jobCatalogId,
      snapshot: sanitized,
      snapshotContentFingerprint: contentFingerprint,
      snapshotContentTruncated: contentTruncated,
      snapshotTruncatedFields: truncatedFields,
      canonicalUrl,
      eventMetadata,
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
