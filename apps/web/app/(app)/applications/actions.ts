'use server';

import {
  changeOwnApplicationStatus,
  createOwnApplication,
  deleteOwnApplication,
  markOwnApplicationApplied,
  revertApplicationEvent,
  updateOwnApplication,
} from '@career-os/database';
import { applicationInputSchema, applicationStatusSchema } from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
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
 * The dashboard's one status-change entry point — branches on APPLIED rather than passing it
 * through to changeOwnApplicationStatus (which now refuses it outright), so this generic control
 * can never bypass the canonical APPLIED transition's applied_at/event semantics
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.0). Every other status still goes through the ordinary
 * status mutation, unchanged.
 */
export async function changeApplicationStatus(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const status = applicationStatusSchema.parse(formData.get('status'));
  if (status === 'APPLIED') {
    await markOwnApplicationApplied(supabase, user.id, id);
  } else {
    await changeOwnApplicationStatus(supabase, user.id, id, status);
  }
  revalidatePath('/applications');
  revalidatePath(`/applications/${id}`);
}

export async function updateApplicationNotes(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  await updateOwnApplication(supabase, user.id, id, {
    notes: (formData.get('notes') as string) || null,
  });
  revalidatePath(`/applications/${id}`);
}

export async function revertEvent(applicationId: string, eventId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await revertApplicationEvent(supabase, user.id, eventId);
  revalidatePath('/applications');
  revalidatePath(`/applications/${applicationId}`);
}
