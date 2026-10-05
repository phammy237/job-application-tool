import { listOwnCandidates, listOwnGithubRepositories } from '@career-os/database';
import { uuidSchema } from '@career-os/shared';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../../lib/myos/load-graph';
import { createClient } from '../../../../../lib/supabase/server';
import { firstParam } from '../../_components/feedback';
import { projectDetailView } from '../detail-helpers';
import { ProjectDetailView } from './project-detail-view';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const sp = await searchParams;

  const user = await requireUser();
  const supabase = await createClient();
  // Every query is scoped to the verified session user (RLS is the backstop).
  const [graph, pendingAll, repos] = await Promise.all([
    loadEvidenceGraphForRequest(user.id),
    listOwnCandidates(supabase, user.id, 'PENDING'),
    listOwnGithubRepositories(supabase, user.id),
  ]);

  const view = projectDetailView(graph, id);
  if (!view) notFound();

  return (
    <ProjectDetailView
      graph={graph}
      view={view}
      pending={pendingAll.filter((c) => c.projectId === id)}
      repo={repos.find((r) => r.projectId === id) ?? null}
      notice={firstParam(sp.notice)}
      error={firstParam(sp.error)}
    />
  );
}
