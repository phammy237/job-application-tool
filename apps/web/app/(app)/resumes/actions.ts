'use server';

import {
  createOwnResume,
  createOwnResumeVersion,
  deleteOwnResume,
  deleteOwnResumeVersion,
  updateOwnResume,
} from '@career-os/database';
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
