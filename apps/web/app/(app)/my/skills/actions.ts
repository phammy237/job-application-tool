'use server';

import { createOwnEdge, createOwnSkill, listOwnSkills } from '@career-os/database';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { errorResult, okResult, toErrorResult, type ActionResult } from './action-result';
import { addSkillFormSchema, linkSkillFormSchema, parseLinkTarget } from './helpers';

function revalidateSkillViews() {
  revalidatePath('/my/skills');
  revalidatePath('/my/timeline');
  revalidatePath('/my');
}

/** Creates a skill. The name/category come from the form; the user id only from the session. */
export async function addSkillAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = addSkillFormSchema.safeParse({
    name: formData.get('name') ?? '',
    category: formData.get('category') ?? undefined,
  });
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? 'Invalid skill.');

  try {
    const supabase = await createClient();
    const existing = await listOwnSkills(supabase, user.id);
    if (existing.some((s) => s.name.trim().toLowerCase() === parsed.data.name.toLowerCase())) {
      return errorResult(`"${parsed.data.name}" is already in your skills.`);
    }
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
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? 'Invalid link.');

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
