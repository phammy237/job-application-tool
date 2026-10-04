'use server';

import {
  createOwnAchievement,
  createOwnEdge,
  createOwnEvidence,
  deleteOwnAchievement,
  deleteOwnEvidence,
  getOwnAchievement,
  getOwnEvidence,
  markAchievementVerifiedIfSupported,
} from '@career-os/database';
import { uuidSchema } from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { parseAddEvidence } from '../projects/form-schemas';
import {
  errorResult,
  okResult,
  toErrorResult,
  type ActionResult,
} from '../_components/action-result';
import { parseAchievementForm } from './helpers';

function revalidate() {
  revalidatePath('/my/achievements');
  revalidatePath('/my/projects');
  revalidatePath('/my/timeline');
  revalidatePath('/my');
}

export async function createAchievementAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseAchievementForm(formData);
  if (!parsed.ok) return errorResult(parsed.message);

  const supabase = await createClient();
  let createdId: string | null = null;
  try {
    const created = await createOwnAchievement(supabase, user.id, parsed.input);
    createdId = created.id;
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
    // Compensate: remove the half-created achievement (its edges cascade) so a retry does not
    // leave a duplicate that is missing its owner link.
    if (createdId) {
      try {
        await deleteOwnAchievement(supabase, user.id, createdId);
      } catch {
        console.error('[career-os] myos achievement cleanup failed');
      }
    }
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

/** Links an existing evidence item to an achievement (USER_PROVIDED SUPPORTS edge). */
export async function linkAchievementEvidenceAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  const evidenceId = uuidSchema.safeParse(formData.get('evidenceId'));
  if (!id.success || !evidenceId.success) return errorResult('Choose an evidence item.');
  try {
    const supabase = await createClient();
    const [achievement, evidence] = await Promise.all([
      getOwnAchievement(supabase, user.id, id.data),
      getOwnEvidence(supabase, user.id, evidenceId.data),
    ]);
    if (!achievement || !evidence)
      return errorResult('That item no longer exists. Refresh and try again.');
    await createOwnEdge(supabase, user.id, {
      fromType: 'EVIDENCE',
      fromId: evidence.id,
      toType: 'ACHIEVEMENT',
      toId: achievement.id,
      relation: 'SUPPORTS',
      verificationState: 'USER_PROVIDED',
    });
    revalidate();
    return okResult('Evidence linked.');
  } catch (error) {
    return toErrorResult(error, 'Could not link the evidence.');
  }
}

/** Creates a new note/link evidence item and links it to the achievement. */
export async function addAchievementEvidenceAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseAddEvidence(formData);
  if (!parsed.ok) return errorResult(parsed.error);
  const input = parsed.data;
  let evidenceId: string | null = null;
  const supabase = await createClient();
  try {
    const achievement = await getOwnAchievement(supabase, user.id, input.id);
    if (!achievement)
      return errorResult('That item no longer exists. Refresh and try again.');
    const evidence = await createOwnEvidence(supabase, user.id, {
      sourceType: input.sourceUrl ? 'LINK' : 'USER_NOTE',
      sourceUrl: input.sourceUrl,
      title: input.title,
      excerpt: input.excerpt,
      occurredAt: input.occurredOn ? `${input.occurredOn}T00:00:00.000Z` : null,
      verificationState: 'USER_PROVIDED',
      visibility: 'PRIVATE',
    });
    evidenceId = evidence.id;
    await createOwnEdge(supabase, user.id, {
      fromType: 'EVIDENCE',
      fromId: evidence.id,
      toType: 'ACHIEVEMENT',
      toId: achievement.id,
      relation: 'SUPPORTS',
      verificationState: 'USER_PROVIDED',
    });
    revalidate();
    return okResult('Evidence added and linked.');
  } catch (error) {
    if (evidenceId) {
      try {
        await deleteOwnEvidence(supabase, user.id, evidenceId);
      } catch {
        console.error('[career-os] myos evidence cleanup failed');
      }
    }
    return toErrorResult(error, 'Could not add the evidence.');
  }
}

/**
 * "Mark verified": only succeeds when at least one evidence item supports the achievement. It is
 * the user's confirmation that the linked evidence backs the claim; nothing is checked externally.
 */
export async function markAchievementVerifiedAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuidSchema.safeParse(formData.get('id'));
  if (!id.success) return errorResult('Invalid achievement.');
  try {
    const supabase = await createClient();
    const result = await markAchievementVerifiedIfSupported(supabase, user.id, id.data);
    if (!result) return errorResult('Link at least one supporting evidence item first.');
    revalidate();
    return okResult('Marked verified.');
  } catch (error) {
    return toErrorResult(error, 'Could not update the achievement.');
  }
}
