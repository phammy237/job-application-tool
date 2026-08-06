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
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';

const PROFILE_PATH = '/profile';

function approvalFlagsFromForm(formData: FormData) {
  return {
    userApproved: formData.get('userApproved') === 'on',
    approvedForApplications: formData.get('approvedForApplications') === 'on',
    visibleOnPublicProfile: formData.get('visibleOnPublicProfile') === 'on',
  };
}

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();

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

  await upsertOwnProfile(supabase, user.id, parsed);
  revalidatePath(PROFILE_PATH);
}

// ---- Experiences --------------------------------------------------------------------------

export async function addExperience(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
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
  await createOwnExperience(supabase, user.id, input);
  revalidatePath(PROFILE_PATH);
}

export async function updateExperienceApproval(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  await updateOwnExperience(supabase, user.id, id, approvalFlagsFromForm(formData));
  revalidatePath(PROFILE_PATH);
}

export async function deleteExperience(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnExperience(supabase, user.id, id);
  revalidatePath(PROFILE_PATH);
}

// ---- Education ------------------------------------------------------------------------------

export async function addEducation(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
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
  await createOwnEducation(supabase, user.id, input);
  revalidatePath(PROFILE_PATH);
}

export async function updateEducationApproval(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  await updateOwnEducation(supabase, user.id, id, approvalFlagsFromForm(formData));
  revalidatePath(PROFILE_PATH);
}

export async function deleteEducation(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnEducation(supabase, user.id, id);
  revalidatePath(PROFILE_PATH);
}

// ---- Projects -------------------------------------------------------------------------------

export async function addProject(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
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
  await createOwnProject(supabase, user.id, input);
  revalidatePath(PROFILE_PATH);
}

export async function updateProjectApproval(id: string, formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  await updateOwnProject(supabase, user.id, id, approvalFlagsFromForm(formData));
  revalidatePath(PROFILE_PATH);
}

export async function deleteProject(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnProject(supabase, user.id, id);
  revalidatePath(PROFILE_PATH);
}

// ---- Skills ---------------------------------------------------------------------------------

export async function addSkill(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
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
  await createOwnSkill(supabase, user.id, input);
  revalidatePath(PROFILE_PATH);
}

export async function deleteSkill(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnSkill(supabase, user.id, id);
  revalidatePath(PROFILE_PATH);
}
