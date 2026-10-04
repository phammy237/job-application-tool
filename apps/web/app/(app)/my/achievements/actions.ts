'use server';

import {
  createOwnAchievement,
  createOwnEdge,
  deleteOwnAchievement,
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
import { parseAchievementForm } from './helpers';

function revalidate() {
  revalidatePath('/my/achievements');
  revalidatePath('/my/timeline');
  revalidatePath('/my');
}

export async function createAchievementAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseAchievementForm(formData);
  if (!parsed.ok) return errorResult(parsed.message);

  try {
    const supabase = await createClient();
    const created = await createOwnAchievement(supabase, user.id, parsed.input);
    // Mirror the owner link as a USER_PROVIDED BELONGS_TO edge so the graph sees it.
    for (const [type, id] of [
      ['PROJECT', parsed.input.projectId],
      ['EXPERIENCE', parsed.input.experienceId],
    ] as const) {
      if (!id) continue;
      await createOwnEdge(supabase, user.id, {
        fromType: 'ACHIEVEMENT',
        fromId: created.id,
        toType: type,
        toId: id,
        relation: 'BELONGS_TO',
        verificationState: 'USER_PROVIDED',
      });
    }
    revalidate();
    return okResult('Achievement added.');
  } catch (error) {
    return toErrorResult(error, 'Could not save the achievement.');
  }
}

export async function deleteAchievementAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid achievement.');
  try {
    const supabase = await createClient();
    await deleteOwnAchievement(supabase, user.id, id.data);
    revalidate();
    return okResult('Deleted.');
  } catch (error) {
    return toErrorResult(error, 'Could not delete the achievement.');
  }
}
