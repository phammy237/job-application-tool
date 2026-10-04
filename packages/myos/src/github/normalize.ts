import { githubRepoSnapshotSchema, type GithubRepoSnapshot } from '@career-os/shared';
import type { RawRepo } from './client';

export interface RepoDetail {
  languages?: Record<string, number>;
  readme?: { text: string; sha: string } | null;
  contributors?: { login: string; contributions: number }[];
  prCount?: number;
  commitCount?: number;
  etag?: string | null;
}

const normalizeDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Pure: raw GitHub API repo JSON (+ optional fetched detail) → validated snapshot. */
export function normalizeRepository(
  raw: RawRepo,
  detail: RepoDetail = {},
): GithubRepoSnapshot {
  return githubRepoSnapshotSchema.parse({
    githubRepoId: raw.id,
    fullName: raw.full_name,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    isPrivate: Boolean(raw.private),
    isFork: Boolean(raw.fork),
    isArchived: Boolean(raw.archived),
    defaultBranch: raw.default_branch ?? null,
    primaryLanguage: raw.language ?? null,
    languages: detail.languages ?? {},
    topics: raw.topics ?? [],
    stars: raw.stargazers_count ?? 0,
    repoCreatedAt: normalizeDate(raw.created_at),
    pushedAt: normalizeDate(raw.pushed_at),
    readmeExcerpt: detail.readme ? detail.readme.text.slice(0, 6000) : null,
    readmeSha: detail.readme?.sha ?? null,
    contributors: detail.contributors ?? [],
    prCount: detail.prCount ?? 0,
    commitCount: detail.commitCount ?? 0,
    etag: detail.etag ?? null,
  });
}
