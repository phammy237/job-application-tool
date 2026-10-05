import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { parseSkillListParams } from './helpers';
import { paramValue } from '../_components/filter-state';
import { SkillsView } from './skills-view';

export const metadata = { title: 'Skills · myOS' };

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseSkillListParams(sp);
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  return (
    <SkillsView
      graph={graph}
      initial={{
        q: params.q,
        category: params.category,
        strength: paramValue(sp.strength, 20),
        sort: paramValue(sp.sort, 20) || params.sort,
      }}
    />
  );
}
