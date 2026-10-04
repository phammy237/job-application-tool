import { githubRepoSnapshotSchema, type GithubRepoSnapshot } from '@career-os/shared';
import type { RawRepo } from './client';
import { cleanText, sanitizeText, truncateCodePoints } from './text';

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
  const clean = (v: string | null | undefined, max: number) => cleanText(v, max);
  const languages: Record<string, number> = {};
  for (const [k, v] of Object.entries(detail.languages ?? {})) {
    const key = truncateCodePoints(sanitizeText(k), 100);
    if (key && typeof v === 'number') languages[key] = v;
  }
  return githubRepoSnapshotSchema.parse({
    githubRepoId: raw.id,
    fullName: sanitizeText(raw.full_name),
    description: clean(raw.description, 2000),
    htmlUrl: sanitizeText(raw.html_url),
    isPrivate: Boolean(raw.private),
    isFork: Boolean(raw.fork),
    isArchived: Boolean(raw.archived),
    defaultBranch: clean(raw.default_branch, 200),
    primaryLanguage: clean(raw.language, 100),
    languages,
    topics: (raw.topics ?? []).map((t) => truncateCodePoints(sanitizeText(t), 100)),
    stars: raw.stargazers_count ?? 0,
    repoCreatedAt: normalizeDate(raw.created_at),
    pushedAt: normalizeDate(raw.pushed_at),
    readmeExcerpt: detail.readme ? truncateCodePoints(sanitizeText(detail.readme.text), 6000) : null,
    readmeSha: detail.readme ? sanitizeText(detail.readme.sha) : null,
    contributors: (detail.contributors ?? []).map((c) => ({
      login: truncateCodePoints(sanitizeText(c.login), 100),
      contributions: c.contributions,
    })),
    prCount: detail.prCount ?? 0,
    commitCount: detail.commitCount ?? 0,
    etag: detail.etag ? sanitizeText(detail.etag) : null,
  });
}
