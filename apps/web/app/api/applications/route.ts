import { NextResponse } from 'next/server';
import {
  getOwnApplicationByJobId,
  getOwnJob,
  recordApplicationEvent,
  recordOwnGeneratedAnswerDecision,
  upsertApplicationFromExtension,
} from '@career-os/database';
import { canonicalizeUrl, saveApplicationRequestSchema, uuidSchema } from '@career-os/shared';
import { getUserIdFromExtensionToken } from '../../../lib/extension-auth';
import { createAdminClient } from '../../../lib/supabase/admin';

/**
 * Called directly by the extension's popup (Phase 4C), same as /api/jobs/analyze and
 * /api/jobs/:id/suggestions — see those routes' corsHeaders doc comments for why reflecting a
 * chrome-extension:// origin is safe here (the bearer-token check below is the real
 * authorization boundary; CORS only affects whether a browser lets JS *read* the response).
 */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin?.startsWith('chrome-extension://')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

/**
 * "Is this job already tracked?" — GET /api/applications?jobId=... (docs/IMPLEMENTATION_PLAN.md
 * Phase 4C). Read-only, exact job_id match; see getOwnApplicationByJobId's doc comment for why
 * this is a best-effort UI hint, not the same matching logic the save path uses.
 */
export async function GET(request: Request) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const jobId = new URL(request.url).searchParams.get('jobId');
  const parsedJobId = uuidSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    return NextResponse.json({ error: 'A valid jobId query parameter is required.' }, { status: 400, headers });
  }

  const supabase = createAdminClient();
  const application = await getOwnApplicationByJobId(supabase, userId, parsedJobId.data);

  return NextResponse.json(
    {
      application: application
        ? { id: application.id, status: application.status, updatedAt: application.updatedAt }
        : null,
    },
    { headers },
  );
}

/**
 * Creates or updates the tracked application for a job (docs/IMPLEMENTATION_PLAN.md Phase 4C).
 * company/title/location/sourceUrl are read from the caller's own already-validated `jobs` row,
 * never from the request body — the extension only supplies jobId, status (SAVED/IN_PROGRESS
 * only; APPLIED is a separate endpoint), the sanitized autofill summary/unresolved-field list,
 * and references to generated_answers rows to mark decided. All matching/atomicity/status-
 * regression-guarding logic lives in upsert_application_from_extension
 * (supabase/migrations/0008_applications_extension_fields.sql); this route only validates,
 * derives the canonical URL, calls it, and links the decided answers afterward.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get('origin'));

  const userId = await getUserIdFromExtensionToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const parsed = saveApplicationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers });
  }

  const supabase = createAdminClient();
  const job = await getOwnJob(supabase, userId, parsed.data.jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404, headers });
  }
  if (!job.company || !job.title) {
    return NextResponse.json(
      { error: 'This job is missing a company or title and cannot be saved as an application yet.' },
      { status: 422, headers },
    );
  }

  const result = await upsertApplicationFromExtension(supabase, userId, {
    jobId: job.id,
    company: job.company,
    title: job.title,
    location: job.location,
    status: parsed.data.status,
    sourceUrl: job.sourceUrl,
    canonicalUrl: canonicalizeUrl(job.sourceUrl),
    atsProvider: job.platformType,
    // No current extractor detects a requisition id (see the migration's column comment) — the
    // matching tier exists and is exercised by tests, but nothing populates it yet in practice.
    externalId: null,
    autofillSummary: parsed.data.autofillSummary,
    unresolvedFields: parsed.data.unresolvedFields,
  });

  // Only record a timeline event for a real transition — a repeat save that doesn't change
  // status (the common case: the user reviews a few more fields and saves again) shouldn't
  // spam application_events with identical SAVED -> SAVED / IN_PROGRESS -> IN_PROGRESS rows.
  if (result.created || result.previousStatus !== result.status) {
    await recordApplicationEvent(supabase, userId, {
      applicationId: result.applicationId,
      eventType: 'STATUS_CHANGE',
      fromStatus: result.created ? null : result.previousStatus,
      toStatus: result.status,
      source: 'USER',
    });
  }

  // Link each decided suggestion to this application and record the user's decision — reuses
  // the existing generated_answers row (never creates a new one), so repeated saves update the
  // same row instead of accumulating duplicate answer-usage rows.
  for (const answered of parsed.data.answeredFields) {
    await recordOwnGeneratedAnswerDecision(supabase, userId, answered.generatedAnswerId, {
      applicationId: result.applicationId,
      jobId: job.id,
      decision: answered.decision,
      finalText: answered.decision === 'EDITED' ? answered.finalText : null,
    });
  }

  return NextResponse.json(
    { applicationId: result.applicationId, status: result.status, created: result.created },
    { headers },
  );
}
