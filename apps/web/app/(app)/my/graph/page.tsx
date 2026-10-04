import { DEFAULT_MAX_NODES, buildEvidenceGraph } from '@career-os/shared';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { GraphView } from './graph-view';

export const metadata = { title: 'Evidence graph' };

export default async function GraphPage() {
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  // Plain JSON-serializable result; the client component never touches the database.
  const viz = buildEvidenceGraph(graph, { maxNodes: DEFAULT_MAX_NODES });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Evidence graph</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How your projects, skills, experience, achievements, stories and evidence
          connect. Everything here comes from what you stored; relations marked
          unconfirmed are suggestions waiting for your review.
        </p>
      </header>
      {viz.nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="text-lg font-medium">Nothing to show yet</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Add a project or import your GitHub repositories and the graph will build
            itself from your evidence.
          </p>
          <Link
            href="/my/projects"
            className="bg-primary text-primary-foreground mt-4 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
          >
            Go to projects
          </Link>
        </div>
      ) : (
        <GraphView viz={viz} />
      )}
    </div>
  );
}
