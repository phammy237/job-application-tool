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
  listOwnEducation,
  listOwnExperiences,
  listOwnProjects,
  listOwnResumeVersionsForResume,
  listOwnResumes,
  listOwnSkills,
  markOwnApplicationApplied,
  revertApplicationEvent,
  setOwnApplicationWorkingResumeVersion,
  updateOwnApplication,
} from '@career-os/database';
import {
  applicationInputSchema,
  applicationStatusSchema,
  buildStructuredResumeFromProfile,
  buildTailoredResumeDisplayName,
  type ConsistencyFinding,
  type StructuredResumeV1,
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
 * user's MASTER resume when one exists, and — this is the real-incident fix, previously this
 * created an empty METADATA_ONLY version that Studio then showed as "no structured version yet,"
 * even though the resume card looked fully usable — its one initial version is populated from a
 * real source of truth, in this preference order, never fabricated, never AI-generated:
 *   A. the user's MASTER resume's latest STRUCTURED_V1 version, cloned verbatim (never mutating
 *      that original version — this only ever reads it);
 *   B. otherwise, the user's approved candidate-profile data (`buildStructuredResumeFromProfile`
 *      — the same canonical import helper Studio's own "Import from profile" button uses, never a
 *      second, duplicated way of turning profile data into résumé content);
 *   C. otherwise, a genuinely blank METADATA_ONLY version — Studio's existing "no structured
 *      version yet — starting a new blank draft" copy already makes this explicit to the user, so
 *      no separate messaging is needed here.
 * Selecting the created version as this application's working résumé happens in the same action,
 * closing the loop from one click.
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

  // Idempotency (real-incident fix — the real account ended up with two identically-named
  // resumes from exactly this double-click race): a TAILORED resume with this exact
  // deterministic name already means "this button was already used for this application," so
  // reuse its latest version rather than creating a duplicate resume/version pair.
  const alreadyCreated = existingResumes.find(
    (r) => r.kind === 'TAILORED' && r.name === displayName,
  );
  if (alreadyCreated) {
    const versions = await listOwnResumeVersionsForResume(supabase, user.id, alreadyCreated.id);
    const latestVersion = versions[0] ?? null; // already ordered version_number desc
    if (latestVersion) {
      await setOwnApplicationWorkingResumeVersion(
        supabase,
        user.id,
        applicationId,
        latestVersion.id,
      );
      revalidatePath('/resumes');
      revalidatePath(`/applications/${applicationId}`);
      return { status: 'ok' };
    }
  }

  // Source A: clone the MASTER resume's latest structured version, if one exists. Read-only —
  // never mutates or re-saves the original version (immutable-version semantics preserved).
  const masterStructuredContent = masterResume
    ? await listOwnResumeVersionsForResume(supabase, user.id, masterResume.id).then(
        (versions) =>
          versions.find((v) => v.snapshotFormat === 'STRUCTURED_V1')?.snapshotPayload ?? null,
      )
    : null;

  // Source B: the user's own approved profile data, via the one canonical import helper — never
  // a second, parallel way of deriving résumé content from candidate-profile tables.
  let profileStructuredContent: StructuredResumeV1 | null = null;
  if (!masterStructuredContent) {
    const [experiences, education, projects, skills] = await Promise.all([
      listOwnExperiences(supabase, user.id),
      listOwnEducation(supabase, user.id),
      listOwnProjects(supabase, user.id),
      listOwnSkills(supabase, user.id),
    ]);
    const imported = buildStructuredResumeFromProfile(
      profile,
      experiences,
      education,
      projects,
      skills,
    );
    // Only actually a usable "source" if it carries real content beyond a bare header — an
    // account with no approved facts yet gets Source C (an honest blank draft) instead of a
    // document that merely *looks* populated.
    const hasRealContent =
      imported.education.length > 0 ||
      imported.experience.length > 0 ||
      imported.projects.length > 0 ||
      imported.skills.length > 0;
    profileStructuredContent = hasRealContent ? imported : null;
  }

  const sourceContent = masterStructuredContent ?? profileStructuredContent;

  const resume = await createOwnResume(supabase, user.id, {
    name: displayName,
    kind: 'TAILORED',
    parentResumeId: masterResume?.id ?? null,
  });
  const version = await createOwnResumeVersion(admin, user.id, {
    resumeId: resume.id,
    displayName,
    ...(sourceContent
      ? { snapshotFormat: 'STRUCTURED_V1' as const, snapshotPayload: sourceContent }
      : {}),
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
