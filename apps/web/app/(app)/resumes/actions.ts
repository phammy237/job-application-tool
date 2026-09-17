'use server';

import {
  createOwnResume,
  createOwnResumeVersion,
  deleteOwnResume,
  deleteOwnResumeVersion,
  getOwnProfile,
  listOwnEducation,
  listOwnExperiences,
  listOwnProjects,
  listOwnResumeVersionsForResume,
  listOwnResumes,
  listOwnSkills,
  updateOwnResume,
} from '@career-os/database';
import { buildStructuredResumeFromProfile } from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { createAdminClient } from '../../../lib/supabase/admin';
import { createClient } from '../../../lib/supabase/server';

export type ActionResult = { status: 'ok' } | { status: 'error'; message: string };

export async function createMasterResume(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const name = (formData.get('name') as string) || 'My Resume';

  const resume = await createOwnResume(supabase, user.id, { name, kind: 'MASTER' });
  revalidatePath('/resumes');
  redirect(`/resumes/${resume.id}`);
}

export async function createTailoredResume(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const name = formData.get('name') as string;
  const parentResumeId = (formData.get('parentResumeId') as string) || null;

  const resume = await createOwnResume(supabase, user.id, {
    name,
    kind: 'TAILORED',
    parentResumeId,
  });
  revalidatePath('/resumes');
  redirect(`/resumes/${resume.id}`);
}

export async function renameResume(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const name = formData.get('name') as string;

  await updateOwnResume(supabase, user.id, id, { name });
  revalidatePath('/resumes');
  revalidatePath(`/resumes/${id}`);
}

export async function deleteResume(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  try {
    await deleteOwnResume(supabase, user.id, id);
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
  revalidatePath('/resumes');
  redirect('/resumes');
}

export async function createResumeVersion(resumeId: string, formData: FormData) {
  const user = await requireUser();
  const admin = createAdminClient();
  const displayName = formData.get('displayName') as string;

  await createOwnResumeVersion(admin, user.id, { resumeId, displayName });
  revalidatePath(`/resumes/${resumeId}`);
}

export async function deleteResumeVersion(
  resumeId: string,
  versionId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  try {
    await deleteOwnResumeVersion(supabase, user.id, versionId);
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
  revalidatePath(`/resumes/${resumeId}`);
  return { status: 'ok' };
}

/**
 * Phase C of the onboarding-path hardening pass: "Create structured master resume" /
 * "Create new master version from profile" — the same underlying operation either way (create
 * a new STRUCTURED_V1 version from the user's current approved Candidate Profile data, via the
 * one canonical `buildStructuredResumeFromProfile` helper — never a duplicated profile→résumé
 * conversion). Creates the MASTER container itself only if one doesn't exist yet; NEVER mutates
 * an existing version — every call adds a new immutable version, exactly like Studio's own save
 * action and `createTailoredResumeForApplication`.
 */
export async function createMasterResumeVersionFromProfile(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [profile, experiences, education, projects, skills, existingResumes] = await Promise.all([
    getOwnProfile(supabase, user.id),
    listOwnExperiences(supabase, user.id),
    listOwnEducation(supabase, user.id),
    listOwnProjects(supabase, user.id),
    listOwnSkills(supabase, user.id),
    listOwnResumes(supabase, user.id),
  ]);

  const content = buildStructuredResumeFromProfile(profile, experiences, education, projects, skills);

  let master = existingResumes.find((r) => r.kind === 'MASTER') ?? null;
  if (!master) {
    master = await createOwnResume(supabase, user.id, {
      name: profile?.fullName ? `${profile.fullName}'s Resume` : 'My Resume',
      kind: 'MASTER',
    });
  }

  const existingVersions = await listOwnResumeVersionsForResume(supabase, user.id, master.id);
  const nextVersionLabel = `Version ${existingVersions.length + 1}`;

  try {
    await createOwnResumeVersion(admin, user.id, {
      resumeId: master.id,
      displayName: nextVersionLabel,
      snapshotFormat: 'STRUCTURED_V1',
      snapshotPayload: content,
    });
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }

  revalidatePath('/resumes');
  revalidatePath(`/resumes/${master.id}`);
  return { status: 'ok' };
}
