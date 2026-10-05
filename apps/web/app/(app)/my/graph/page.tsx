import { DEFAULT_MAX_NODES, buildEvidenceGraph } from '@career-os/shared';
import { buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { EmptyState } from '../_components/badges';
import { PageHeader } from '../_components/page-header';
import { GraphView } from './graph-view';

export const metadata = { title: 'Evidence graph' };

export default async function GraphPage() {
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  // Plain JSON-serializable result; the client component never touches the database.
  const viz = buildEvidenceGraph(graph, { maxNodes: DEFAULT_MAX_NODES });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence graph"
        description="How your projects, skills, experience, achievements, stories and evidence connect. Everything here comes from what you stored; relations marked unconfirmed are suggestions waiting for your review."
      />
      {viz.nodes.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Add a project or import your GitHub repositories and the graph will build itself from your evidence."
          action={
            <Link href="/my/projects" className={buttonVariants({ size: 'sm' })}>
              Go to projects
            </Link>
          }
        />
      ) : (
        <GraphView viz={viz} />
      )}
    </div>
  );
}
