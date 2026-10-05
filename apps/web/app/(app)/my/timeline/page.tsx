import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { paramValue } from '../_components/filter-state';
import { parseTimelineParams } from './helpers';
import { TimelineView } from './timeline-view';

export const metadata = { title: 'Timeline · myOS' };

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseTimelineParams(sp);
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  return (
    <TimelineView
      graph={graph}
      initial={{
        q: paramValue(sp.q),
        type: params.type ?? '',
        year: params.year !== null ? String(params.year) : '',
        skill: params.skillId ?? '',
      }}
    />
  );
}
