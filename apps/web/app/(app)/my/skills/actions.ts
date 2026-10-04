'use server';

import {
  createOwnEdge,
  createOwnSkill,
  deleteOwnSkill,
  listOwnSkills,
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
} from '../_components/action-result';
import { addSkillFormSchema, linkSkillFormSchema, parseLinkTarget } from './helpers';

function revalidateSkillViews() {
  revalidatePath('/my/skills');
  revalidatePath('/my/timeline');
  revalidatePath('/my');
}

/** Postgres unique_violation as surfaced by the database layer (code on the cause or message). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  const message = error instanceof Error ? error.message : '';
  return code === '23505' || /23505|duplicate key/i.test(message);
}

/** Deletes one of the user's skills (its graph edges cascade). Projects and evidence are kept. */
export async function deleteSkillAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid skill.');
  try {
    const supabase = await createClient();
    await deleteOwnSkill(supabase, user.id, id.data);
    revalidateSkillViews();
    return okResult('Skill deleted.');
  } catch (error) {
    return toErrorResult(error, 'Could not delete the skill.');
  }
}

/** Creates a skill. The name/category come from the form; the user id only from the session. */
export async function addSkillAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = addSkillFormSchema.safeParse({
    name: formData.get('name') ?? '',
    category: formData.get('category') ?? undefined,
  });
  if (!parsed.success)
    return errorResult(parsed.error.issues[0]?.message ?? 'Invalid skill.');

  try {
    const supabase = await createClient();
    const existing = await listOwnSkills(supabase, user.id);
    if (
      existing.some((s) => s.name.trim().toLowerCase() === parsed.data.name.toLowerCase())
    ) {
      return errorResult(`"${parsed.data.name}" is already in your skills.`);
    }
    try {
      await createOwnSkill(supabase, user.id, {
        sourceFactId: null,
        name: parsed.data.name,
        category: parsed.data.category,
        proficiency: null,
        // The user typed or explicitly clicked Add; it is NOT approved for applications.
        userApproved: true,
        approvedForApplications: false,
        visibleOnPublicProfile: false,
      });
    } catch (createError) {
      // A double submit loses the race on the unique index: re-select the winner and succeed.
      if (isUniqueViolation(createError)) {
        const again = await listOwnSkills(supabase, user.id);
        if (
          again.some(
            (s) => s.name.trim().toLowerCase() === parsed.data.name.toLowerCase(),
          )
        ) {
          revalidateSkillViews();
          return okResult(`Added "${parsed.data.name}".`);
        }
      }
      throw createError;
    }
    revalidateSkillViews();
    return okResult(`Added "${parsed.data.name}".`);
  } catch (error) {
    return toErrorResult(error, 'Could not add the skill.');
  }
}

/** Links a project/experience to a skill with a USER_PROVIDED DEMONSTRATES edge. */
export async function linkSkillAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = linkSkillFormSchema.safeParse({
    skillId: formData.get('skillId'),
    target: formData.get('target'),
  });
  if (!parsed.success)
    return errorResult(parsed.error.issues[0]?.message ?? 'Invalid link.');

  try {
    const supabase = await createClient();
    const target = parseLinkTarget(parsed.data.target);
    await createOwnEdge(supabase, user.id, {
      fromType: target.type,
      fromId: target.id,
      toType: 'SKILL',
      toId: parsed.data.skillId,
      relation: 'DEMONSTRATES',
      verificationState: 'USER_PROVIDED',
    });
    revalidateSkillViews();
    return okResult('Linked.');
  } catch (error) {
    return toErrorResult(error, 'Could not create the link.');
  }
}
