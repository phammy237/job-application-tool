import {
  getOwnGithubConnection,
  listOwnCandidates,
  listOwnGithubRepositories,
  listOwnGithubSyncRuns,
} from '@career-os/database';
import { requireUser } from '../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../lib/myos/load-graph';
import { createClient } from '../../../lib/supabase/server';
import { OverviewView } from './overview-view';

export default async function MyOverviewPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Every query is scoped to the verified session user (RLS is the backstop).
  const [graph, pending, connection, repos, runs] = await Promise.all([
    loadEvidenceGraphForRequest(user.id),
    listOwnCandidates(supabase, user.id, 'PENDING'),
    getOwnGithubConnection(supabase, user.id),
    listOwnGithubRepositories(supabase, user.id),
    listOwnGithubSyncRuns(supabase, user.id, 1),
  ]);

  return (
    <OverviewView
      graph={graph}
      pending={pending}
      connection={connection}
      repoCount={repos.length}
      selectedRepoCount={repos.filter((r) => r.selected).length}
      lastRun={runs[0] ?? null}
    />
  );
}
