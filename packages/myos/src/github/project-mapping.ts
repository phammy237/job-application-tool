import type {
  GithubRepository,
  GithubRepoSnapshot,
  ProjectInput,
} from '@career-os/shared';

type RepoLike = Pick<
  GithubRepository | GithubRepoSnapshot,
  'fullName' | 'description' | 'htmlUrl' | 'repoCreatedAt' | 'pushedAt' | 'topics'
>;

export interface ProjectFromRepository extends ProjectInput {
  origin: 'GITHUB';
  status: 'ACTIVE' | 'COMPLETED';
  visibility: 'PRIVATE';
}

export function humanizeRepoName(fullName: string): string {
  const name = fullName.includes('/') ? fullName.split('/').slice(1).join('/') : fullName;
  const words = name
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = words.map((w) =>
    w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w,
  );
  return out.join(' ') || fullName;
}

/**
 * Pure mapping repo → project insert fields. Imports are always UNAPPROVED and PRIVATE: the user
 * must approve before any generation or public use. The caller adds the repo-evidence→project
 * REPRESENTS edge.
 */
export function createProjectFromRepository(
  repo: RepoLike,
  now: Date = new Date(),
): ProjectFromRepository {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const pushed = repo.pushedAt ? new Date(repo.pushedAt) : null;
  const active = pushed !== null && !Number.isNaN(pushed.getTime()) && pushed >= cutoff;
  return {
    sourceFactId: null,
    name: humanizeRepoName(repo.fullName),
    description: repo.description ?? null,
    role: null,
    startDate: repo.repoCreatedAt ? repo.repoCreatedAt.slice(0, 10) : null,
    endDate: null,
    url: repo.htmlUrl,
    tags: [...repo.topics],
    userApproved: false,
    approvedForApplications: false,
    visibleOnPublicProfile: false,
    origin: 'GITHUB',
    status: active ? 'ACTIVE' : 'COMPLETED',
    visibility: 'PRIVATE',
  };
}
