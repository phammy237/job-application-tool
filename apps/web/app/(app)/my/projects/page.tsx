import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { firstParam } from '../_components/feedback';
import { paramValue } from '../_components/filter-state';
import { ProjectsListView } from './projects-list-view';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata = { title: 'Projects · myOS' };

export default async function MyProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);

  return (
    <ProjectsListView
      graph={graph}
      initial={{
        q: paramValue(params.q),
        status: paramValue(params.status, 20),
        origin: paramValue(params.origin, 20),
        sort: paramValue(params.sort, 20),
      }}
      notice={firstParam(params.notice)}
      error={firstParam(params.error)}
    />
  );
}
