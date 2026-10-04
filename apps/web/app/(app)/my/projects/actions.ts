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
  deleteOwnEvidence,
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
import type { ErrorCode, NoticeCode } from '../_components/feedback-messages';
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
 *  - the outcome is reported by redirecting back with a fixed `?notice=` / `?error=` CODE (never
 *    free text) that the page maps to a message in an aria-live region.
 */

class ActionError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

interface Ctx {
  supabase: CareerOsSupabaseClient;
  userId: string;
}

function back(
  path: string,
  key: 'notice' | 'error',
  code: NoticeCode | ErrorCode,
): never {
  redirect(`${path}?${key}=${code}#feedback`);
}

function must<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new ActionError('invalid');
  return r.data;
}

/** Compensating cleanup must never mask the original failure. */
async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    console.error('[career-os] myos compensating cleanup failed');
  }
}

async function assertOwnsProject(ctx: Ctx, projectId: string): Promise<void> {
  const project = await getOwnProjectDetail(ctx.supabase, ctx.userId, projectId);
  if (!project) throw new ActionError('not_found');
}

/**
 * Runs `fn` with a session-derived context, then redirects back to the project page. The
 * redirect is outside the try/catch because Next implements redirect() by throwing.
 */
async function withProject(
  fd: FormData,
  fn: (ctx: Ctx, projectId: string) => Promise<NoticeCode>,
): Promise<never> {
  const user = await requireUser();
  const rawId = fd.get('id');
  const path =
    typeof rawId === 'string' && /^[0-9a-f-]{36}$/i.test(rawId)
      ? `/my/projects/${rawId}`
      : '/my/projects';
  let outcome: { key: 'notice' | 'error'; code: NoticeCode | ErrorCode };
  try {
    const supabase = await createClient();
    const ctx: Ctx = { supabase, userId: user.id };
    const id = must(parseIdOnly(fd)).id;
    await assertOwnsProject(ctx, id);
    const code = await fn(ctx, id);
    revalidatePath(`/my/projects/${id}`);
    revalidatePath('/my/projects');
    revalidatePath('/my');
    outcome = { key: 'notice', code };
  } catch (error) {
    if (!(error instanceof ActionError)) {
      console.error('[career-os] myos project action failed', (error as Error)?.name);
    }
    outcome = {
      key: 'error',
      code: error instanceof ActionError ? error.code : 'failed',
    };
  }
  return back(path, outcome.key, outcome.code);
}

// --------------------------------------------------------------------------------------------

export async function createProjectAction(fd: FormData): Promise<never> {
  const user = await requireUser();
  let projectId: string | null = null;
  let createdId: string | null = null;
  let supabase: CareerOsSupabaseClient | null = null;
  let error: ErrorCode | null = null;
  try {
    const input = must(parseCreateProject(fd));
    supabase = await createClient();
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
    createdId = project.id;
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
    error = e instanceof ActionError ? e.code : 'create_failed';
    // Compensate: do not leave a half-created project (no status/summary) behind.
    if (createdId && supabase) {
      const client = supabase;
      const orphan = createdId;
      await bestEffort(() => deleteOwnProject(client, user.id, orphan));
    }
  }
  if (projectId) redirect(`/my/projects/${projectId}?notice=project_created`);
  return back('/my/projects', 'error', error ?? 'create_failed');
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
    return 'project_saved';
  });
}

export async function setProjectApprovalAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseApproval(fd));
    await updateOwnProject(ctx.supabase, ctx.userId, id, {
      userApproved: input.userApproved,
      approvedForApplications: input.approvedForApplications,
    });
    return 'approval_saved';
  });
}

export async function setProjectVisibilityAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseVisibility(fd));
    await updateOwnProjectDetail(ctx.supabase, ctx.userId, id, {
      visibility: input.visibility,
    });
    return 'visibility_saved';
  });
}

export async function saveTalkingPointsAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const input = must(parseTalkingPoints(fd));
    await updateOwnProjectDetail(ctx.supabase, ctx.userId, id, {
      talkingPoints: input.talkingPoints,
    });
    return 'talking_points_saved';
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
    return 'skill_added';
  });
}

/** Deletes an edge only after confirming it is attached to this project. */
async function removeProjectEdge(
  ctx: Ctx,
  projectId: string,
  edgeId: string,
): Promise<void> {
  const edges = await listOwnEdgesForNode(ctx.supabase, ctx.userId, 'PROJECT', projectId);
  if (!edges.some((e) => e.id === edgeId)) throw new ActionError('edge_mismatch');
  await deleteOwnEdge(ctx.supabase, ctx.userId, edgeId);
}

export async function removeProjectSkillAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { edgeId } = must(parseEdgeRemoval(fd));
    await removeProjectEdge(ctx, id, edgeId);
    return 'skill_removed';
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
    return 'achievement_added';
  });
}

export async function deleteProjectAchievementAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other: achievementId } = must(parseIdPair(fd, 'achievementId'));
    const achievement = await getOwnAchievement(ctx.supabase, ctx.userId, achievementId);
    if (!achievement || achievement.projectId !== id) {
      throw new ActionError('achievement_mismatch');
    }
    await deleteOwnAchievement(ctx.supabase, ctx.userId, achievementId);
    return 'achievement_deleted';
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
    try {
      await createOwnEdge(ctx.supabase, ctx.userId, {
        fromType: 'EVIDENCE',
        fromId: evidence.id,
        toType: 'PROJECT',
        toId: id,
        relation: 'SUPPORTS',
        verificationState: 'USER_PROVIDED',
      });
    } catch (e) {
      // Compensate: an unlinked evidence row would be an orphan the user cannot see here.
      await bestEffort(() => deleteOwnEvidence(ctx.supabase, ctx.userId, evidence.id));
      throw e;
    }
    return 'evidence_added';
  });
}

export async function unlinkProjectEvidenceAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { edgeId } = must(parseEdgeRemoval(fd));
    await removeProjectEdge(ctx, id, edgeId);
    return 'evidence_unlinked';
  });
}

/**
 * Deletes an evidence record, only when it is linked to this project. Its edges cascade, so
 * anything else it supported loses that support.
 */
export async function deleteProjectEvidenceAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other: evidenceId } = must(parseIdPair(fd, 'evidenceId'));
    const edges = await listOwnEdgesForNode(ctx.supabase, ctx.userId, 'PROJECT', id);
    if (!edges.some((e) => e.fromType === 'EVIDENCE' && e.fromId === evidenceId)) {
      throw new ActionError('evidence_mismatch');
    }
    await deleteOwnEvidence(ctx.supabase, ctx.userId, evidenceId);
    return 'evidence_deleted';
  });
}

async function ownPendingCandidate(ctx: Ctx, projectId: string, candidateId: string) {
  const candidate = await getOwnCandidate(ctx.supabase, ctx.userId, candidateId);
  if (!candidate || candidate.projectId !== projectId) {
    throw new ActionError('candidate_mismatch');
  }
  if (candidate.status !== 'PENDING') throw new ActionError('candidate_decided');
  return candidate;
}

export async function acceptCandidateAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other } = must(parseIdPair(fd, 'candidateId'));
    await ownPendingCandidate(ctx, id, other);
    const result = await acceptOwnCandidate(ctx.supabase, ctx.userId, other);
    if (result?.status === 'conflict') {
      throw new ActionError('candidate_conflict');
    }
    return 'candidate_accepted';
  });
}

export async function rejectCandidateAction(fd: FormData): Promise<never> {
  return withProject(fd, async (ctx, id) => {
    const { other } = must(parseIdPair(fd, 'candidateId'));
    await ownPendingCandidate(ctx, id, other);
    await rejectOwnCandidate(ctx.supabase, ctx.userId, other);
    return 'candidate_rejected';
  });
}

export async function deleteProjectAction(fd: FormData): Promise<never> {
  const user = await requireUser();
  let error: ErrorCode | null = null;
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
    error = e instanceof ActionError ? e.code : 'delete_failed';
  }
  if (error) return back('/my/projects', 'error', error);
  return back('/my/projects', 'notice', 'project_deleted');
}
