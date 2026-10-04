'use server';

import {
  createOwnStory,
  deleteOwnStory,
  getOwnStory,
  replaceOwnEdgesFrom,
  updateOwnStory,
} from '@career-os/database';
import { uuidSchema } from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import {
  errorResult,
  okResult,
  toErrorResult,
  type ActionResult,
} from '../skills/action-result';
import { parseStoryForm, type ParsedStoryForm } from './helpers';

type Supabase = Awaited<ReturnType<typeof createClient>>;

function revalidate(storyId?: string) {
  revalidatePath('/my/stories');
  if (storyId) revalidatePath(`/my/stories/${storyId}`);
  revalidatePath('/my');
}

async function syncLinks(
  supabase: Supabase,
  userId: string,
  storyId: string,
  links: Pick<ParsedStoryForm, 'projectIds' | 'experienceIds' | 'evidenceIds'>,
) {
  const groups = [
    ['PROJECT', links.projectIds],
    ['EXPERIENCE', links.experienceIds],
    ['EVIDENCE', links.evidenceIds],
  ] as const;
  for (const [toType, toIds] of groups) {
    await replaceOwnEdgesFrom(supabase, userId, {
      fromType: 'STORY',
      fromId: storyId,
      relation: 'REFERENCES',
      toType,
      // The user picked these links explicitly.
      targets: toIds.map((toId) => ({ toId, verificationState: 'USER_PROVIDED' as const })),
    });
  }
}

export async function createStoryAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseStoryForm(formData);
  if (!parsed.ok) return errorResult(parsed.message);
  try {
    const supabase = await createClient();
    const story = await createOwnStory(supabase, user.id, {
      ...parsed.value.input,
      verificationState: 'USER_PROVIDED',
    });
    await syncLinks(supabase, user.id, story.id, parsed.value);
    revalidate();
    return okResult('Story saved.');
  } catch (error) {
    return toErrorResult(error, 'Could not save the story.');
  }
}

export async function updateStoryAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid story.');
  const parsed = parseStoryForm(formData);
  if (!parsed.ok) return errorResult(parsed.message);
  try {
    const supabase = await createClient();
    const existing = await getOwnStory(supabase, user.id, id.data);
    if (!existing) return errorResult('Story not found.');
    // verificationState is intentionally untouched: editing never silently promotes AI/inferred
    // stories, and the form cannot set it.
    await updateOwnStory(supabase, user.id, id.data, parsed.value.input);
    await syncLinks(supabase, user.id, id.data, parsed.value);
    revalidate(id.data);
    return okResult('Story updated.');
  } catch (error) {
    return toErrorResult(error, 'Could not update the story.');
  }
}

export async function deleteStoryAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid story.');
  try {
    const supabase = await createClient();
    await deleteOwnStory(supabase, user.id, id.data);
    revalidate(id.data);
    return okResult('Story deleted.');
  } catch (error) {
    return toErrorResult(error, 'Could not delete the story.');
  }
}

/** "Mark ready for interviews" toggle (user_approved). */
export async function setStoryApprovedAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid story.');
  const approved = formData.get('approved') === '1';
  try {
    const supabase = await createClient();
    await updateOwnStory(supabase, user.id, id.data, { userApproved: approved });
    revalidate(id.data);
    return okResult(approved ? 'Marked ready for interviews.' : 'Marked as draft.');
  } catch (error) {
    return toErrorResult(error, 'Could not update the story.');
  }
}
