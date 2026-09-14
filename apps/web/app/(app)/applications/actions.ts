'use server';

import {
  ConsistencyCheckFailedError,
  changeOwnApplicationStatus,
  clearOwnApplicationWorkingResumeVersion,
  createOwnApplication,
  createOwnResume,
  createOwnResumeVersion,
  deleteOwnApplication,
  getOwnApplication,
  getOwnProfile,
  listOwnResumes,
  markOwnApplicationApplied,
  revertApplicationEvent,
  setOwnApplicationWorkingResumeVersion,
  updateOwnApplication,
} from '@career-os/database';
import {
  applicationInputSchema,
  applicationStatusSchema,
  buildTailoredResumeDisplayName,
  type ConsistencyFinding,
} from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { createAdminClient } from '../../../lib/supabase/admin';
import { createClient } from '../../../lib/supabase/server';

export async function createApplication(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();

  const input = applicationInputSchema.parse({
    company: formData.get('company'),
    title: formData.get('title'),
    status: formData.get('status') || 'SAVED',
    notes: formData.get('notes') || null,
  });

  const application = await createOwnApplication(supabase, user.id, input);
  revalidatePath('/applications');
  redirect(`/applications/${application.id}`);
}

export async function deleteApplication(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnApplication(supabase, user.id, id);
  revalidatePath('/applications');
  redirect('/applications');
}

/**
 * The dashboard's generic status-change entry point. The status `<select>` this backs no longer
 * offers `APPLIED` as an option at all (docs/IMPLEMENTATION_PLAN.md Phase 5B.2 — use
 * `markApplicationApplied` below, which runs the consistency-review flow) — the branch here is
 * defense-in-depth, not the primary path: an ordinary HTML form is not a security boundary, so a
 * hand-crafted POST could still submit `status=APPLIED`. That still can't bypass the canonical
 * operation or its gate; it just doesn't get the friendly findings-review UI (an unacknowledged
 * finding surfaces as a thrown error here, not a rendered review panel). Every other status still
 * goes through the ordinary status mutation, unchanged.
 *
 * Uses the service-role admin client, not the session-scoped one: `markOwnApplicationApplied`
 * calls the service-role-only `mark_application_applied` RPC as of Phase 5B.1, same as the
 * extension's PATCH /api/applications/:id/mark-applied route — `userId` is still always derived
 * from the verified session (`requireUser`), never client-supplied, so this is the same
 * "privileged operation, independently user-scoped" pattern CLAUDE.md already establishes for
 * apps/web/app/(app)/settings/actions.ts.
 */
export async function changeApplicationStatus(id: string, formData: FormData) {
  const user = await requireUser();
  const status = applicationStatusSchema.parse(formData.get('status'));
  if (status === 'APPLIED') {
    const admin = createAdminClient();
    await markOwnApplicationApplied(admin, user.id, id);
  } else {
    const supabase = await createClient();
    await changeOwnApplicationStatus(supabase, user.id, id, status);
  }
  revalidatePath('/applications');
  revalidatePath(`/applications/${id}`);
}

export type MarkApplicationAppliedResult =
  | { status: 'ok'; applicationStatus: string }
  | {
      status: 'consistency_check_failed';
      reason: 'blocking_findings' | 'unacknowledged_warnings';
      findings: ConsistencyFinding[];
    }
  | { status: 'error'; message: string };

/**
 * The dashboard's dedicated "Mark as Applied" action, driving the consistency-review flow
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.2H) — called directly from a client component
 * (`MarkAppliedPanel`), not bound to a plain `<form action=...>`, since the caller needs the
 * structured result to render findings/errors inline rather than navigating away. Returns a
 * discriminated result instead of throwing across the server/client boundary — `markAppliedAt`
 * page can present a `consistency_check_failed` result as a real review UI, not a crash. Uses the
 * admin client for the same reason `changeApplicationStatus`'s APPLIED branch does (Phase 5B.1's
 * service-role-only RPC).
 */
export async function markApplicationApplied(
  id: string,
  acknowledgedFindingIds: string[],
): Promise<MarkApplicationAppliedResult> {
  const user = await requireUser();
  const admin = createAdminClient();

  try {
    const application = await markOwnApplicationApplied(admin, user.id, id, {
      acknowledgedFindingIds,
    });
    revalidatePath('/applications');
    revalidatePath(`/applications/${id}`);
    return { status: 'ok', applicationStatus: application.status };
  } catch (error) {
    if (error instanceof ConsistencyCheckFailedError) {
      return {
        status: 'consistency_check_failed',
        reason: error.reason,
        findings: error.findings,
      };
    }
    // Not found and not-owned are indistinguishable on purpose (CLAUDE.md) — a generic message
    // either way, never leaking which case occurred.
    return { status: 'error', message: 'Could not mark this application as applied.' };
  }
}

export async function updateApplicationNotes(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  await updateOwnApplication(supabase, user.id, id, {
    notes: (formData.get('notes') as string) || null,
  });
  revalidatePath(`/applications/${id}`);
}

/**
 * Uses the service-role admin client, not the session-scoped one: as of Phase 5B hardening
 * (migration 0015), `revertApplicationEvent`'s applications-table write may need to restore
 * `status='APPLIED'` — the one accepted exception to "only mark_application_applied produces
 * APPLIED" — which the new `applications_guard_applied_transition` trigger only permits for a
 * `service_role`-executed write. `userId` is still always derived from the verified session
 * (`requireUser`), never client-supplied, so this is the same "privileged operation,
 * independently user-scoped" pattern already used for `changeApplicationStatus`'s APPLIED
 * branch and `markApplicationApplied` above.
 */
export async function revertEvent(applicationId: string, eventId: string) {
  const user = await requireUser();
  const admin = createAdminClient();
  await revertApplicationEvent(admin, user.id, eventId);
  revalidatePath('/applications');
  revalidatePath(`/applications/${applicationId}`);
}

/**
 * "Select resume" / "Change" (docs/IMPLEMENTATION_PLAN.md "Phase 7B" §17) — an ordinary
 * session-scoped write, not the admin client: cross-user selection is already structurally
 * impossible via the composite FK (migration 0021), so no elevated privilege is needed here, same
 * posture as `updateApplicationNotes`.
 */
export async function selectWorkingResumeVersion(
  applicationId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const supabase = await createClient();
  const resumeVersionId = formData.get('resumeVersionId') as string;
  if (!resumeVersionId) return;

  await setOwnApplicationWorkingResumeVersion(
    supabase,
    user.id,
    applicationId,
    resumeVersionId,
  );
  revalidatePath(`/applications/${applicationId}`);
}

export async function clearWorkingResumeVersion(applicationId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await clearOwnApplicationWorkingResumeVersion(supabase, user.id, applicationId);
  revalidatePath(`/applications/${applicationId}`);
}

export type CreateTailoredResumeResult =
  { status: 'ok' } | { status: 'error'; message: string };

/**
 * "Create resume for this application" (docs/IMPLEMENTATION_PLAN.md "Phase 7A" §21/"Phase 7B").
 * Creates a TAILORED resume named per the naming convention (the owner's real name, never a
 * hardcoded one — see `buildTailoredResumeDisplayName`'s own doc comment), descended from the
 * user's MASTER resume when one exists, with one initial METADATA_ONLY version so there is
 * immediately something real to select as this application's working résumé — never fabricated
 * content, just a real, dated, named identity. Selecting it as the working résumé happens in the
 * same action, closing the loop from one click.
 */
export async function createTailoredResumeForApplication(
  applicationId: string,
): Promise<CreateTailoredResumeResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const application = await getOwnApplication(supabase, user.id, applicationId);
  if (!application) {
    return { status: 'error', message: 'Application not found.' };
  }
  const profile = await getOwnProfile(supabase, user.id);
  const displayName = buildTailoredResumeDisplayName(
    profile?.fullName ?? null,
    application.company,
    application.title,
  );

  const existingResumes = await listOwnResumes(supabase, user.id);
  const masterResume = existingResumes.find((r) => r.kind === 'MASTER') ?? null;

  const resume = await createOwnResume(supabase, user.id, {
    name: displayName,
    kind: 'TAILORED',
    parentResumeId: masterResume?.id ?? null,
  });
  const version = await createOwnResumeVersion(admin, user.id, {
    resumeId: resume.id,
    displayName,
  });
  await setOwnApplicationWorkingResumeVersion(
    supabase,
    user.id,
    applicationId,
    version.id,
  );

  revalidatePath('/resumes');
  revalidatePath(`/applications/${applicationId}`);
  return { status: 'ok' };
}
