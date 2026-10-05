import {
  getOwnGithubConnection,
  listOwnGithubRepositories,
  listOwnGithubSyncRuns,
} from '@career-os/database';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { PageHeader } from '../_components/page-header';
import {
  GithubPanel,
  type ConnectionView,
  type RepoView,
  type RunView,
} from './github-panel';

export default async function MyGithubPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [connection, repositories, runs] = await Promise.all([
    getOwnGithubConnection(supabase, user.id),
    listOwnGithubRepositories(supabase, user.id),
    listOwnGithubSyncRuns(supabase, user.id, 5),
  ]);

  // Project to the minimal serializable shape the client panel needs. No token material exists
  // in these rows (it lives in github_credentials, readable only by the service role).
  const connectionView: ConnectionView | null = connection
    ? {
        githubLogin: connection.githubLogin,
        hasToken: connection.hasToken,
        status: connection.status,
        lastError: connection.lastError,
        lastSyncedAt: connection.lastSyncedAt,
      }
    : null;
  const repos: RepoView[] = repositories.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    htmlUrl: r.htmlUrl,
    primaryLanguage: r.primaryLanguage,
    stars: r.stars,
    pushedAt: r.pushedAt,
    isPrivate: r.isPrivate,
    selected: r.selected,
    projectId: r.projectId,
    syncStatus: r.syncStatus,
    syncError: r.syncError,
  }));
  const runViews: RunView[] = runs.map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    error: r.error,
    stats: r.stats,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="GitHub"
        description="Import repositories as projects. Everything imported starts private and unapproved, and detected skills are suggestions until you confirm them."
      />
      <GithubPanel connection={connectionView} repos={repos} runs={runViews} />
    </div>
  );
}
