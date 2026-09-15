import { NextResponse } from 'next/server';
import {
  SaveReviewedTailoredResumeError,
  getOwnApplication,
  getOwnCompanyResearchSnapshot,
  getOwnProfile,
  getOwnResume,
  getOwnResumeVersion,
  isOwnResumeWorkingForOtherApplication,
  listOwnApprovedFactsForGeneration,
  saveReviewedTailoredResume,
} from '@career-os/database';
import {
  buildReviewedTailoredResume,
  buildTailoredResumeDisplayName,
  saveReviewedTailoredResumeInputSchema,
  structuredResumeV1Schema,
  validateResumeTailoringSaveSubmission,
  type ResumeTailoringOperationDecision,
  type ResumeTailoringOperationEdit,
  type ResumeTailoringOperationWithId,
} from '@career-os/shared';
import { getCurrentUser } from '../../../../../../lib/auth';
import { createAdminClient } from '../../../../../../lib/supabase/admin';
import { createClient } from '../../../../../../lib/supabase/server';

/**
 * POST /api/applications/:id/resume-tailoring/save — Phase 7F's one persistence path for a
 * reviewed AI résumé-tailoring draft (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §47). Everything up
 * to this call (accept/reject/edit, the live preview) is client-side and non-durable; nothing is
 * written to the database until this route succeeds.
 *
 * Zero provider invocation (§16/§42/§61) — this route imports nothing from `@career-os/ai` and
 * calls no Claude endpoint. Every fact/grounding/ownership check below runs against data fetched
 * fresh in this request, never against anything the client claims about the (ephemeral, never
 * persisted) Phase 7E proposal it originally received.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: applicationId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'invalid_request' }, { status: 400 });
  }
  const parsed = saveReviewedTailoredResumeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ status: 'invalid_request' }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();
  const admin = createAdminClient();

  // Step 1 — ownership + staleness (§14/§15). Both anchors are re-checked again, atomically,
  // inside the save RPC itself (migration 0024) — these are the same checks run early so a stale
  // or cross-user request gets a clear, specific rejection before any of the heavier
  // fact/grounding revalidation work below runs.
  const application = await getOwnApplication(supabase, user.id, applicationId);
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }
  if (!application.workingResumeVersionId) {
    return NextResponse.json({ status: 'no_working_resume' });
  }
  if (application.workingResumeVersionId !== input.baseResumeVersionId) {
    return NextResponse.json({
      status: 'stale_base_resume',
      currentWorkingResumeVersionId: application.workingResumeVersionId,
    });
  }
  if ((application.jobSnapshotId ?? null) !== input.jobSnapshotId) {
    return NextResponse.json({
      status: 'stale_job_context',
      currentJobSnapshotId: application.jobSnapshotId,
    });
  }

  const baseVersion = await getOwnResumeVersion(
    supabase,
    user.id,
    application.workingResumeVersionId,
  );
  if (!baseVersion || baseVersion.snapshotFormat !== 'STRUCTURED_V1') {
    return NextResponse.json({ status: 'unsupported_resume_format' });
  }
  const baseResume = baseVersion.snapshotPayload;

  // §39 — a custom Advanced LaTeX override is never silently carried forward; the user must
  // explicitly acknowledge that saving regenerates LaTeX from structured content instead.
  if (baseResume.renderOverride !== null && !input.acknowledgeCustomLatexOverrideReset) {
    return NextResponse.json({ status: 'custom_latex_override_ack_required' });
  }

  const baseLogicalResume = await getOwnResume(supabase, user.id, baseVersion.resumeId);
  if (!baseLogicalResume) {
    // Defensive — the composite FK makes this unreachable in practice.
    return NextResponse.json({ status: 'unsupported_resume_format' });
  }

  // Step 2 — reconstruct review state from the request, and revalidate it against FRESH data
  // (§13/§48): the user's currently-approved facts, never anything echoed from the client's
  // claimed `groundedFacts` labels.
  const operations: ResumeTailoringOperationWithId[] = input.operations.map((entry) => ({
    operationId: entry.operationId,
    operation: entry.operation,
  }));
  const decisions = new Map<string, ResumeTailoringOperationDecision>(
    input.operations.map((entry) => [entry.operationId, entry.decision]),
  );
  const edits = new Map<string, ResumeTailoringOperationEdit>(
    input.operations
      .filter(
        (entry): entry is typeof entry & { edit: ResumeTailoringOperationEdit } =>
          entry.edit !== null,
      )
      .map((entry) => [entry.operationId, entry.edit]),
  );

  const approvedFacts = await listOwnApprovedFactsForGeneration(supabase, user.id);
  const approvedFactIds = new Set(approvedFacts.map((f) => f.id));
  const factTextById = new Map(approvedFacts.map((f) => [f.id, f.text]));

  const validation = validateResumeTailoringSaveSubmission({
    baseResume,
    operations,
    decisions,
    edits,
    approvedFactIds,
    factTextById,
  });
  if (validation.status === 'rejected') {
    if (validation.reason === 'unresolved_operations') {
      return NextResponse.json({ status: 'unresolved_operations' });
    }
    return NextResponse.json({
      status: 'validation_failed',
      reason: validation.reason,
      detail: validation.detail,
    });
  }

  const reviewed = buildReviewedTailoredResume({
    baseResume,
    operations,
    decisions,
    edits,
  });
  if (reviewed.groundingViolations.length > 0) {
    // Unreachable given `validateResumeTailoringSaveSubmission` already passed above — kept as an
    // explicit defense-in-depth check rather than trusting the two functions can never disagree.
    return NextResponse.json({
      status: 'validation_failed',
      reason: reviewed.groundingViolations[0]!.reason,
      detail: reviewed.groundingViolations[0]!.detail,
    });
  }
  if (!reviewed.hasChangesFromBase) {
    return NextResponse.json({ status: 'no_changes' });
  }

  const contentCheck = structuredResumeV1Schema.safeParse(reviewed.resume);
  if (!contentCheck.success) {
    return NextResponse.json({
      status: 'validation_failed',
      reason: 'invalid_content',
      detail: 'schema',
    });
  }

  // Step 3 — decide where the saved version lives (§17/§18/§28/§29): tailoring from MASTER always
  // produces a new TAILORED résumé; tailoring from an existing TAILORED résumé appends the next
  // version to it UNLESS that résumé is also the working résumé for some other application, in
  // which case this save clones into a new application-specific TAILORED résumé instead, so it
  // never silently changes what "working résumé" means for that other application.
  const profile = await getOwnProfile(supabase, user.id);
  const versionDisplayName = buildTailoredResumeDisplayName(
    profile?.fullName ?? null,
    application.company,
    application.title,
  );

  let targetResumeId: string | null = null;
  let newResumeName: string | null = null;
  let newResumeParentId: string | null = null;

  if (baseLogicalResume.kind === 'MASTER') {
    newResumeName = versionDisplayName;
    newResumeParentId = baseLogicalResume.id;
  } else {
    const sharedWithAnotherApplication = await isOwnResumeWorkingForOtherApplication(
      supabase,
      user.id,
      baseLogicalResume.id,
      applicationId,
    );
    if (sharedWithAnotherApplication) {
      newResumeName = versionDisplayName;
      newResumeParentId = baseLogicalResume.parentResumeId;
    } else {
      targetResumeId = baseLogicalResume.id;
    }
  }

  // Phase 7H (§9/§41) — an explicit, owned check of the proposal's own companyResearchSnapshotId,
  // never trusted blindly. Deliberately NOT a staleness gate: identity, not latestness, is what
  // matters (§9), so a snapshot that's simply no longer the "latest" one is still forwarded as-is.
  // If it can no longer be resolved at all (deleted, or somehow not owned), this degrades to null
  // rather than blocking the save entirely — the reviewed résumé content is unaffected either way,
  // and losing only the audit-provenance link is more honest than refusing a save over it.
  let companyResearchSnapshotId: string | null = null;
  if (input.companyResearchSnapshotId) {
    const researchSnapshot = await getOwnCompanyResearchSnapshot(
      supabase,
      user.id,
      input.companyResearchSnapshotId,
    );
    companyResearchSnapshotId = researchSnapshot?.id ?? null;
  }

  try {
    const saved = await saveReviewedTailoredResume(admin, user.id, {
      applicationId,
      expectedWorkingResumeVersionId: input.baseResumeVersionId,
      expectedJobSnapshotId: input.jobSnapshotId,
      targetResumeId,
      newResumeName,
      newResumeParentId,
      versionDisplayName,
      snapshotPayload: contentCheck.data,
      companyResearchSnapshotId,
    });

    return NextResponse.json({
      status: 'ok',
      applicationId,
      resumeId: saved.resumeId,
      resumeCreated: saved.resumeCreated,
      versionId: saved.versionId,
      versionNumber: saved.versionNumber,
      displayName: saved.displayName,
    });
  } catch (error) {
    if (error instanceof SaveReviewedTailoredResumeError) {
      switch (error.reason) {
        case 'stale_base_resume':
          return NextResponse.json({
            status: 'stale_base_resume',
            currentWorkingResumeVersionId: error.currentValue,
          });
        case 'stale_job_context':
          return NextResponse.json({
            status: 'stale_job_context',
            currentJobSnapshotId: error.currentValue,
          });
        case 'application_not_found':
          return NextResponse.json({ error: 'Application not found' }, { status: 404 });
        case 'resume_not_found':
          // Unreachable in practice — targetResumeId is always this same request's own
          // freshly-read, owned logical résumé id. Fails closed rather than silently retrying.
          return NextResponse.json({
            status: 'validation_failed',
            reason: 'resume_not_found',
            detail: '',
          });
        case 'company_research_snapshot_not_found':
          // Unreachable in practice — companyResearchSnapshotId is already ownership-checked
          // above and nulled out rather than forwarded when it doesn't resolve. Fails closed
          // rather than silently retrying, same posture as resume_not_found above.
          return NextResponse.json({
            status: 'validation_failed',
            reason: 'company_research_snapshot_not_found',
            detail: '',
          });
        default: {
          const exhaustiveCheck: never = error.reason;
          return exhaustiveCheck;
        }
      }
    }
    throw error;
  }
}
