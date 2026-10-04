import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createOwnEdge,
  createOwnProject,
  getOwnGithubConnection,
  getOwnGithubRepository,
  setOwnGithubRepositoryProject,
  setOwnGithubRepositorySelected,
  updateOwnProjectDetail,
  upsertOwnEvidenceBySource,
} from '@career-os/database';
import { createProjectFromRepository } from '@career-os/myos';
import { uuidSchema } from '@career-os/shared';
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

  // Idempotent: a repo that already has a project is returned as-is, never given a second one.
  if (body.data.selected && !repo.projectId) {
    const mapped = createProjectFromRepository(repo);
    const { origin: _origin, status, visibility, ...projectInput } = mapped;
    void _origin;
    const project = await createOwnProject(supabase, user.id, projectInput);
    // status + visibility via the myOS detail update; origin is set in the same step below.
    await updateOwnProjectDetail(supabase, user.id, project.id, { status, visibility });
    const { error: originError } = await supabase
      .from('projects')
      .update({ origin: 'GITHUB' })
      .eq('id', project.id)
      .eq('user_id', user.id);
    if (originError) {
      console.error('[career-os] could not mark imported project origin');
      return NextResponse.json({ error: 'Could not import repository' }, { status: 500 });
    }
    updated = await setOwnGithubRepositoryProject(supabase, user.id, id, project.id);

    // Ensure the repo evidence exists now (idempotent with the sync's identical upsert) so the
    // REPRESENTS edge can be created before the first deep sync completes.
    // Evidence creation is service-role only (triggers); user_id is the session user's. Without a
    // token-validated connection ownership of the login is unproven, so it is USER_PROVIDED.
    const connection = await getOwnGithubConnection(supabase, user.id);
    const evidence = await upsertOwnEvidenceBySource(createAdminClient(), user.id, {
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
    await createOwnEdge(supabase, user.id, {
      fromType: 'EVIDENCE',
      fromId: evidence.id,
      toType: 'PROJECT',
      toId: project.id,
      relation: 'REPRESENTS',
      verificationState: 'USER_PROVIDED',
    });
  }

  return NextResponse.json({ repository: updated });
}
