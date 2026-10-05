import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { firstParam } from '../_components/feedback';
import { paramValue } from '../_components/filter-state';
import { parseStoryFilter } from './helpers';
import { StoriesView } from './stories-view';

export const metadata = { title: 'Stories · myOS' };

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseStoryFilter(sp);
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  return (
    <StoriesView
      graph={graph}
      initial={{
        q: paramValue(sp.q),
        competency: filter.competency ?? '',
        approved: filter.approvedOnly ? '1' : '',
      }}
      notice={firstParam(sp.notice)}
    />
  );
}
