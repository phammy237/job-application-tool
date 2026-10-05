import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { paramValue } from '../_components/filter-state';
import { AchievementsView } from './achievements-view';

export const metadata = { title: 'Achievements · myOS' };

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  return (
    <AchievementsView
      graph={graph}
      initial={{
        q: paramValue(sp.q),
        kind: paramValue(sp.kind, 20),
        verified: paramValue(sp.verified, 1),
      }}
    />
  );
}
