import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  claimOwnGithubRepositoryProject,
  createOwnEdge,
  createOwnProject,
  deleteOwnProject,
  getOwnGithubConnection,
  getOwnGithubRepository,
  setOwnGithubRepositoryProject,
  setOwnGithubRepositorySelected,
  updateOwnProjectDetail,
  upsertOwnEvidenceBySource,
} from '@career-os/database';
import { createProjectFromRepository } from '@career-os/myos';
import { uuidSchema, type GithubRepository } from '@career-os/shared';
import { getCurrentUser } from '../../../../../../../lib/auth';
import { readCappedText } from '../../../../../../../lib/myos/read-body';
import { createAdminClient } from '../../../../../../../lib/supabase/admin';
import { createClient } from '../../../../../../../lib/supabase/server';

const bodySchema = z.object({ selected: z.boolean() });

/**
 * Toggles whether a repository is deep-synced. Selecting a repository that has no project yet
 * imports it as an UNAPPROVED, PRIVATE project (never auto-approved) and links the repo's
 * GITHUB_REPO evidence to it with a REPRESENTS edge. Unselecting keeps any project already created.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid repository id' }, { status: 400 });
  }
  const raw = await readCappedText(request, 256);
  if (raw === null) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabase = await createClient();
  const repo = await getOwnGithubRepository(supabase, user.id, id);
  if (!repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
  }

  let updated = await setOwnGithubRepositorySelected(
    supabase,
    user.id,
    id,
    body.data.selected,
  );

  if (!body.data.selected) return NextResponse.json({ repository: updated });

  // Idempotent: a repo that already has a project is never given a second one. Its REPRESENTS
  // edge is repaired if a previous attempt failed between linking and edge creation.
  if (repo.projectId) {
    try {
      await ensureRepresentsEdge(supabase, user.id, repo, repo.projectId);
    } catch {
      console.error('[career-os] could not repair repository evidence link');
      return NextResponse.json({ error: 'Could not import repository' }, { status: 500 });
    }
    return NextResponse.json({ repository: updated });
  }

  const mapped = createProjectFromRepository(repo);
  const { origin: _origin, status, visibility, ...projectInput } = mapped;
  void _origin;
  let projectId: string | null = null;
  try {
    const project = await createOwnProject(supabase, user.id, projectInput);
    projectId = project.id;
    // status + visibility via the myOS detail update; origin is set in the same step below.
    await updateOwnProjectDetail(supabase, user.id, project.id, { status, visibility });
    const { error: originError } = await supabase
      .from('projects')
      .update({ origin: 'GITHUB' })
      .eq('id', project.id)
      .eq('user_id', user.id);
    if (originError) throw new Error('origin update failed');

    // Atomic claim: only one concurrent request can attach a project to this repository.
    const claimed = await claimOwnGithubRepositoryProject(supabase, user.id, id, project.id);
    if (!claimed) {
      await deleteOwnProject(supabase, user.id, project.id);
      projectId = null;
      const current = await getOwnGithubRepository(supabase, user.id, id);
      if (current?.projectId) {
        await ensureRepresentsEdge(supabase, user.id, current, current.projectId);
        return NextResponse.json({ repository: current });
      }
      throw new Error('repository claim lost');
    }
    updated = claimed;
    await ensureRepresentsEdge(supabase, user.id, repo, project.id);
  } catch {
    console.error('[career-os] could not import repository');
    if (projectId) {
      // Compensate: release the repository and remove the half-imported project.
      try {
        await setOwnGithubRepositoryProject(supabase, user.id, id, null);
        await deleteOwnProject(supabase, user.id, projectId);
      } catch {
        console.error('[career-os] import cleanup failed');
      }
    }
    return NextResponse.json({ error: 'Could not import repository' }, { status: 500 });
  }

  return NextResponse.json({ repository: updated });
}

/**
 * Ensures the repo evidence exists (idempotent with the sync's identical upsert) and is linked
 * to the project with a REPRESENTS edge. Evidence creation is service-role only (triggers);
 * user_id is the session user's. Without a token-validated connection ownership of the login is
 * unproven, so it is USER_PROVIDED.
 */
async function ensureRepresentsEdge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  repo: GithubRepository,
  projectId: string,
): Promise<void> {
  const connection = await getOwnGithubConnection(supabase, userId);
  const evidence = await upsertOwnEvidenceBySource(createAdminClient(), userId, {
    sourceType: 'GITHUB_REPO',
    sourceRef: repo.fullName,
    sourceUrl: repo.htmlUrl,
    title: repo.fullName,
    excerpt: repo.description,
    occurredAt: repo.pushedAt,
    verificationState: connection?.hasToken ? 'VERIFIED' : 'USER_PROVIDED',
    visibility: 'PRIVATE',
    metadata: {
      languages: repo.languages,
      topics: repo.topics,
      isPrivate: repo.isPrivate,
      stars: repo.stars,
    },
  });
  await createOwnEdge(supabase, userId, {
    fromType: 'EVIDENCE',
    fromId: evidence.id,
    toType: 'PROJECT',
    toId: projectId,
    relation: 'REPRESENTS',
    verificationState: 'USER_PROVIDED',
  });
}


