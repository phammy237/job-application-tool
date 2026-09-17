'use server';

import {
  createOwnEducation,
  createOwnExperience,
  createOwnProject,
  createOwnSkill,
  deleteOwnEducation,
  deleteOwnExperience,
  deleteOwnProject,
  deleteOwnSkill,
  updateOwnEducation,
  updateOwnExperience,
  updateOwnProject,
  upsertOwnProfile,
} from '@career-os/database';
import {
  educationInputSchema,
  experienceInputSchema,
  profileUpdateSchema,
  projectInputSchema,
  skillInputSchema,
} from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
// Type-only: a `'use server'` file may only export async functions, so the runtime
// INITIAL_PROFILE_ACTION_STATE constant lives in its own plain module — see that file's doc
// comment for the real crash this split fixes. The type itself is erased at compile time and is
// safe to keep re-exported from here for convenience.
import type { ProfileActionState } from './profile-action-state';

export type { ProfileActionState };

const PROFILE_PATH = '/profile';

/**
 * Shared result shape for every /profile mutation — the `useActionState` convention this whole
 * file uses, matching `apps/web/app/(public)/actions.ts`'s existing `AuthFormState` precedent
 * (`signIn`/`signUp`). Real production bug this exists to fix: every one of these actions used to
 * let `<schema>.parse()` (and any DB error) throw straight out of a plain `<form action={fn}>`,
 * uncaught anywhere, which Next.js turns into a full "Application error: a server-side exception
 * has occurred" crash page — not a validation message. A perfectly ordinary input (e.g. typing
 * "linkedin.com/in/name" into LinkedIn without "https://", which `profileLinksSchema`'s `.url()`
 * rejects) reproduced this every time. Every mutation below now returns this instead of throwing.
 */

/**
 * Converts any thrown error into a safe, actionable message — never a raw DB/stack/SQL detail
 * (docs/SECURITY_AND_PRIVACY.md, CLAUDE.md). A Zod validation error is safe to surface verbatim
 * (it only ever describes input shape, e.g. "links.linkedin: Invalid url") since that's exactly
 * the actionable, in-form message the user needs; anything else (a `DatabaseError` or any other
 * unexpected failure) collapses to one generic, honest "did not save" message — the failure is
 * still reported, just never with internal detail.
 */
function toActionErrorMessage(error: unknown, context: string): string {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.join('.') || 'value';
    return `${field}: ${first?.message ?? 'invalid value'}`;
  }
  console.error(`[career-os] ${context} failed`, error);
  return 'Could not save your changes — please try again.';
}

function approvalFlagsFromForm(formData: FormData) {
  return {
    userApproved: formData.get('userApproved') === 'on',
    approvedForApplications: formData.get('approvedForApplications') === 'on',
    visibleOnPublicProfile: formData.get('visibleOnPublicProfile') === 'on',
  };
}

export async function updateProfile(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const parsed = profileUpdateSchema.parse({
      fullName: formData.get('fullName') || null,
      headline: formData.get('headline') || null,
      email: formData.get('email') || null,
      phone: formData.get('phone') || null,
      location: formData.get('location') || null,
      workAuthorization: formData.get('workAuthorization') || null,
      relocationPreference: formData.get('relocationPreference') || null,
      links: {
        linkedin: formData.get('linkedin') || null,
        portfolio: formData.get('portfolio') || null,
        github: formData.get('github') || null,
        website: formData.get('website') || null,
      },
    });

    const supabase = await createClient();
    // upsertOwnProfile's onConflict: 'user_id' upsert is naturally idempotent — a double-clicked
    // Save just writes the same values twice, never a duplicate row (profiles.user_id is the
    // primary key).
    await upsertOwnProfile(supabase, user.id, parsed);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'updateProfile') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

// ---- Experiences --------------------------------------------------------------------------

export async function addExperience(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const input = experienceInputSchema.parse({
      sourceFactId: null,
      company: formData.get('company'),
      title: formData.get('title'),
      location: formData.get('location') || null,
      employmentType: formData.get('employmentType') || null,
      startDate: formData.get('startDate') || null,
      endDate: formData.get('endDate') || null,
      description: formData.get('description') || null,
      tags: [],
      displayOrder: 0,
      ...approvalFlagsFromForm(formData),
    });
    const supabase = await createClient();
    await createOwnExperience(supabase, user.id, input);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'addExperience') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function updateExperienceApproval(
  id: string,
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await updateOwnExperience(supabase, user.id, id, approvalFlagsFromForm(formData));
  } catch (error) {
    return { error: toActionErrorMessage(error, 'updateExperienceApproval') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function deleteExperience(
  id: string,
  _prevState: ProfileActionState,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await deleteOwnExperience(supabase, user.id, id);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'deleteExperience') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

// ---- Education ------------------------------------------------------------------------------

export async function addEducation(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const input = educationInputSchema.parse({
      sourceFactId: null,
      school: formData.get('school'),
      degree: formData.get('degree') || null,
      fieldOfStudy: formData.get('fieldOfStudy') || null,
      startDate: formData.get('startDate') || null,
      graduationDate: formData.get('graduationDate') || null,
      gpa: formData.get('gpa') || null,
      honors: [],
      ...approvalFlagsFromForm(formData),
    });
    const supabase = await createClient();
    await createOwnEducation(supabase, user.id, input);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'addEducation') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function updateEducationApproval(
  id: string,
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await updateOwnEducation(supabase, user.id, id, approvalFlagsFromForm(formData));
  } catch (error) {
    return { error: toActionErrorMessage(error, 'updateEducationApproval') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function deleteEducation(
  id: string,
  _prevState: ProfileActionState,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await deleteOwnEducation(supabase, user.id, id);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'deleteEducation') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

// ---- Projects -------------------------------------------------------------------------------

export async function addProject(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const input = projectInputSchema.parse({
      sourceFactId: null,
      name: formData.get('name'),
      description: formData.get('description') || null,
      role: formData.get('role') || null,
      startDate: formData.get('startDate') || null,
      endDate: formData.get('endDate') || null,
      url: formData.get('url') || null,
      tags: [],
      ...approvalFlagsFromForm(formData),
    });
    const supabase = await createClient();
    await createOwnProject(supabase, user.id, input);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'addProject') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function updateProjectApproval(
  id: string,
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await updateOwnProject(supabase, user.id, id, approvalFlagsFromForm(formData));
  } catch (error) {
    return { error: toActionErrorMessage(error, 'updateProjectApproval') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function deleteProject(
  id: string,
  _prevState: ProfileActionState,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await deleteOwnProject(supabase, user.id, id);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'deleteProject') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

// ---- Skills ---------------------------------------------------------------------------------

export async function addSkill(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const input = skillInputSchema.parse({
      sourceFactId: null,
      name: formData.get('name'),
      category: formData.get('category') || null,
      proficiency: formData.get('proficiency') || null,
      // Skills are low-risk BASIC_PROFILE-adjacent data (docs/EXTENSION_DESIGN.md §6 lists
      // SKILLS as requiring approval before autofill, but self-entered skills default to
      // approved since the user just typed them themselves, same as any other profile field).
      userApproved: true,
      approvedForApplications: true,
      visibleOnPublicProfile: false,
    });
    const supabase = await createClient();
    await createOwnSkill(supabase, user.id, input);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'addSkill') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}

export async function deleteSkill(
  id: string,
  _prevState: ProfileActionState,
): Promise<ProfileActionState> {
  const user = await requireUser();

  try {
    const supabase = await createClient();
    await deleteOwnSkill(supabase, user.id, id);
  } catch (error) {
    return { error: toActionErrorMessage(error, 'deleteSkill') };
  }

  revalidatePath(PROFILE_PATH);
  return { error: null };
}
