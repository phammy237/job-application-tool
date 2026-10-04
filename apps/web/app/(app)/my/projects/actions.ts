'use server';

import {
  acceptOwnCandidate,
  createOwnAchievement,
  createOwnEdge,
  createOwnEvidence,
  createOwnProject,
  createOwnSkill,
  deleteOwnAchievement,
  deleteOwnEdge,
  deleteOwnProject,
  getOwnAchievement,
  getOwnCandidate,
  getOwnProjectDetail,
  listOwnEdgesForNode,
  listOwnSkills,
  rejectOwnCandidate,
  updateOwnProject,
  updateOwnProjectDetail,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import {
  parseAddAchievement,
  parseAddEvidence,
  parseAddSkill,
  parseApproval,
  parseCreateProject,
  parseEdgeRemoval,
  parseIdOnly,
  parseIdPair,
  parseTalkingPoints,
  parseUpdateProject,
  parseVisibility,
  type ParseResult,
} from './form-schemas';

/**
 * Server actions for /my/projects. Contract for every action:
 *  - the user id comes from `requireUser()` (the verified session) — never from the form;
 *  - the FormData is validated with zod before any write;
 *  - the target project is re-checked to belong to that user (RLS is the backstop, not the only
 *    check), and child rows (edges, achievements, candidates) are re-checked to belong to it;
 *  - the outcome is reported by redirecting back with `?notice=` or `?error=` so the page can
 *    render it in an aria-live region without client JavaScript.
 */

class ActionError extends Error {}

interface Ctx {
  supabase: CareerOsSupabaseClient;
  userId: string;
}

function back(path: string, key: 'notice' | 'error', message: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(message)}#feedback`);
}

function must<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new ActionError(r.error);
  return r.data;
}

async function assertOwnsProject(ctx: Ctx, projectId: string): Promise<void> {
  const project = await getOwnProjectDetail(ctx.supabase, ctx.userId, projectId);
  if (!project) throw new ActionError('Project not found');
}

/**
 * Runs `fn` with a session-derived context, then redirects back to the project page. The
 * redirect is outside the try/catch because Next implements redirect() by throwing.
 */
async function withProject(
  fd: FormData,
  fn: (ctx: Ctx, projectId: string) => Promise<string>,
): Promise<never> {
  const user = await requireUser();
  const rawId = fd.get('id');
  const path = typeof rawId === 'string' && /^[0-9a-f-]{36}$/i.test(rawId) ? `/my/projects/${rawId}` : '/my/projects';
  let outcome: { key: 'notice' | 'error'; message: string };
  try {
    const supabase = await createClient();
    const ctx: Ctx = { supabase, userId: user.id };
    const id = must(parseIdOnly(fd)).id;
    await assertOwnsProject(ctx, id);
    const message = await fn(ctx, id);
    revalidatePath(`/my/projects/${id}`);
    revalidatePath('/my/projects');
    revalidatePath('/my');
    outcome = { key: 'notice', message };
  } catch (error) {
    if (!(error instanceof ActionError)) {
      console.error('[career-os] myos project action failed', (error as Error)?.name);
    }
    outcome = {
      key: 'error',
      message: error instanceof ActionError ? error.message : 'Something went wrong. Please try again.',
    };
  }
  return back(path, outcome.key, outcome.message);
}

// --------------------------------------------------------------------------------------------

export async function createProjectAction(fd: FormData): Promise<never> {
  const user = await requireUser();
  let projectId: string | null = null;
  let error: string | null = null;
  try {
    const input = must(parseCreateProject(fd));
    const supabase = await createClient();
    const project = await createOwnProject(supabase, user.id, {
      name: input.name,
      description: null,
      role: input.role,
      startDate: input.startDate,
      endDate: input.endDate,
      url: input.url,
      sourceFactId: null,
      tags: [],
      // Nothing is approved or public by omission.
      userApproved: false,
      approvedForApplications: false,
      visibleOnPublicProfile: false,
    });
    await updateOwnProjectDetail(supabase, user.id, project.id, {
      status: input.status,
      summary: input.summary,
    });
    projectId = project.id;
    revalidatePath('/my/projects');
    revalidatePath('/my');
  } catch (e) {
    if (!(e instanceof ActionError)) {
      console.error('[career-os] myos create project failed', (e as Error)?.name);
    }
    error = e instanceof ActionError ? e.message : 'Could not create the project. Please try again.';
  }
  if (projectId) redirect(`/my/projects/${projectId}?notice=${encodeURIComponent('Project created')}`);
  return back('/my/projects', 'error', error ?? 'Could not create the project');
}

export async function updateProjectAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseUpdateProject(fd));
    await updateOwnProject(ctx.supabase, ctx.userId, id, {
      name: input.name,
      role: input.role,
      description: input.description,
      url: input.url,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    await updateOwnProjectDetail(ctx.supabase, ctx.userId, id, {
      status: input.status,
      summary: input.summary,
      collaborators: input.collaborators,
    });
    return 'Project details saved';
  });
}

export async function setProjectApprovalAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseApproval(fd));
    await updateOwnProject(ctx.supabase, ctx.userId, id, {
      userApproved: input.userApproved,
      approvedForApplications: input.approvedForApplications,
    });
    return 'Approval saved';
  });
}

export async function setProjectVisibilityAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseVisibility(fd));
    await updateOwnProjectDetail(ctx.supabase, ctx.userId, id, { visibility: input.visibility });
    return 'Visibility saved';
  });
}

export async function saveTalkingPointsAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseTalkingPoints(fd));
    await updateOwnProjectDetail(ctx.supabase, ctx.userId, id, {
      talkingPoints: input.talkingPoints,
    });
    return 'Talking points saved';
  });
}

export async function addProjectSkillAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { skill } = must(parseAddSkill(fd));
    const wanted = skill.toLowerCase();
    const existing = (await listOwnSkills(ctx.supabase, ctx.userId)).find(
      (s) => s.name.trim().toLowerCase() === wanted,
    );
    const skillId =
      existing?.id ??
      (
        await createOwnSkill(ctx.supabase, ctx.userId, {
          sourceFactId: null,
          name: skill,
          category: null,
          proficiency: null,
          // Typing a skill onto your own project confirms it exists; approving it for
          // applications is a separate decision made on the profile.
          userApproved: true,
          approvedForApplications: false,
          visibleOnPublicProfile: false,
        })
      ).id;
    await createOwnEdge(ctx.supabase, ctx.userId, {
      fromType: 'PROJECT',
      fromId: id,
      toType: 'SKILL',
      toId: skillId,
      relation: 'DEMONSTRATES',
      verificationState: 'USER_PROVIDED',
    });
    return `Added ${skill}`;
  });
}

/** Deletes an edge only after confirming it is attached to this project. */
async function removeProjectEdge(ctx: Ctx, projectId: string, edgeId: string): Promise<void> {
  const edges = await listOwnEdgesForNode(ctx.supabase, ctx.userId, 'PROJECT', projectId);
  if (!edges.some((e) => e.id === edgeId)) throw new ActionError('That link does not belong to this project');
  await deleteOwnEdge(ctx.supabase, ctx.userId, edgeId);
}

export async function removeProjectSkillAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { edgeId } = must(parseEdgeRemoval(fd));
    await removeProjectEdge(ctx, id, edgeId);
    return 'Skill removed from this project';
  });
}

export async function addProjectAchievementAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseAddAchievement(fd));
    await createOwnAchievement(ctx.supabase, ctx.userId, {
      title: input.title,
      description: input.description,
      kind: input.kind,
      occurredOn: input.occurredOn,
      metricText: input.metricText,
      projectId: id,
      // The user typed it: confirmed by them, but never VERIFIED until evidence supports it.
      verificationState: 'USER_PROVIDED',
      userApproved: true,
      visibility: 'PRIVATE',
    });
    return 'Achievement added';
  });
}

export async function deleteProjectAchievementAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other: achievementId } = must(parseIdPair(fd, 'achievementId'));
    const achievement = await getOwnAchievement(ctx.supabase, ctx.userId, achievementId);
    if (!achievement || achievement.projectId !== id) {
      throw new ActionError('That achievement does not belong to this project');
    }
    await deleteOwnAchievement(ctx.supabase, ctx.userId, achievementId);
    return 'Achievement deleted';
  });
}

export async function addProjectEvidenceAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseAddEvidence(fd));
    const evidence = await createOwnEvidence(ctx.supabase, ctx.userId, {
      sourceType: input.sourceUrl ? 'LINK' : 'USER_NOTE',
      sourceUrl: input.sourceUrl,
      title: input.title,
      excerpt: input.excerpt,
      occurredAt: input.occurredOn ? `${input.occurredOn}T00:00:00.000Z` : null,
      verificationState: 'USER_PROVIDED',
      visibility: 'PRIVATE',
    });
    await createOwnEdge(ctx.supabase, ctx.userId, {
      fromType: 'EVIDENCE',
      fromId: evidence.id,
      toType: 'PROJECT',
      toId: id,
      relation: 'SUPPORTS',
      verificationState: 'USER_PROVIDED',
    });
    return 'Evidence added';
  });
}

export async function unlinkProjectEvidenceAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { edgeId } = must(parseEdgeRemoval(fd));
    await removeProjectEdge(ctx, id, edgeId);
    return 'Evidence unlinked (the evidence record itself is kept)';
  });
}

async function ownPendingCandidate(ctx: Ctx, projectId: string, candidateId: string) {
  const candidate = await getOwnCandidate(ctx.supabase, ctx.userId, candidateId);
  if (!candidate || candidate.projectId !== projectId) {
    throw new ActionError('That suggestion does not belong to this project');
  }
  if (candidate.status !== 'PENDING') throw new ActionError('That suggestion was already decided');
  return candidate;
}

export async function acceptCandidateAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other } = must(parseIdPair(fd, 'candidateId'));
    await ownPendingCandidate(ctx, id, other);
    await acceptOwnCandidate(ctx.supabase, ctx.userId, other);
    return 'Suggestion accepted and added to your profile';
  });
}

export async function rejectCandidateAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other } = must(parseIdPair(fd, 'candidateId'));
    await ownPendingCandidate(ctx, id, other);
    await rejectOwnCandidate(ctx.supabase, ctx.userId, other);
    return 'Suggestion rejected';
  });
}

export async function deleteProjectAction(fd: FormData): Promise<never> {
  const user = await requireUser();
  let error: string | null = null;
  try {
    const { id } = must(parseIdOnly(fd));
    const supabase = await createClient();
    await assertOwnsProject({ supabase, userId: user.id }, id);
    await deleteOwnProject(supabase, user.id, id);
    revalidatePath('/my/projects');
    revalidatePath('/my');
  } catch (e) {
    if (!(e instanceof ActionError)) {
      console.error('[career-os] myos delete project failed', (e as Error)?.name);
    }
    error = e instanceof ActionError ? e.message : 'Could not delete the project';
  }
  if (error) return back('/my/projects', 'error', error);
  return back('/my/projects', 'notice', 'Project deleted');
}
