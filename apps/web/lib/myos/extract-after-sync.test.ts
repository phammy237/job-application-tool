import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOwnGithubRepositories: vi.fn(),
  listOwnEvidence: vi.fn(),
  createOwnCandidatesIdempotent: vi.fn(),
}));

vi.mock('@career-os/database', () => mocks);

import { generateCandidatesForSelectedRepos } from './extract-after-sync';

const supabase = {} as never;

function repo(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    fullName: 'me/planner',
    description: 'A scheduling app',
    primaryLanguage: 'TypeScript',
    languages: { TypeScript: 9000, CSS: 1000 },
    topics: [],
    readmeExcerpt: 'Built with React and PostgreSQL.',
    prCount: 3,
    contributors: [],
    selected: true,
    projectId: 'proj-1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOwnEvidence.mockResolvedValue([
    { id: 'e-repo', sourceType: 'GITHUB_REPO', sourceRef: 'me/planner' },
    { id: 'e-readme', sourceType: 'GITHUB_README', sourceRef: 'me/planner' },
    { id: 'e-pr', sourceType: 'GITHUB_PR', sourceRef: 'me/planner#1' },
    { id: 'e-other', sourceType: 'GITHUB_REPO', sourceRef: 'me/other' },
  ]);
  mocks.createOwnCandidatesIdempotent.mockResolvedValue({ created: 2, skipped: 1 });
});

describe('generateCandidatesForSelectedRepos', () => {
  it('extracts for selected repos with a project, passing only that repo evidence ids', async () => {
    mocks.listOwnGithubRepositories.mockResolvedValue([repo()]);
    const r = await generateCandidatesForSelectedRepos(supabase, 'user-1');
    expect(r).toEqual({ repositories: 1, created: 2, skipped: 1 });
    expect(mocks.listOwnGithubRepositories).toHaveBeenCalledWith(supabase, 'user-1');
    expect(mocks.listOwnEvidence).toHaveBeenCalledWith(supabase, 'user-1');
    const [, userId, inputs] = mocks.createOwnCandidatesIdempotent.mock.calls[0]!;
    expect(userId).toBe('user-1');
    expect(inputs.length).toBeGreaterThan(0);
    for (const c of inputs) {
      expect(c.projectId).toBe('proj-1');
      expect(c.evidenceIds).toEqual(['e-repo', 'e-readme']);
      expect(c.dedupeKey).toBeTruthy();
    }
  });

  it('skips unselected repos and repos without a project', async () => {
    mocks.listOwnGithubRepositories.mockResolvedValue([
      repo({ selected: false }),
      repo({ id: 'r2', projectId: null }),
    ]);
    const r = await generateCandidatesForSelectedRepos(supabase, 'user-1');
    expect(r.repositories).toBe(0);
    expect(mocks.createOwnCandidatesIdempotent).not.toHaveBeenCalled();
  });

  it('writes the candidates of several repos in one batched call, keeping per-project scoping', async () => {
    mocks.listOwnGithubRepositories.mockResolvedValue([
      repo(),
      repo({ id: 'r2', fullName: 'me/other', projectId: 'proj-2' }),
    ]);
    const r = await generateCandidatesForSelectedRepos(supabase, 'user-1');
    expect(r.repositories).toBe(2);
    expect(mocks.createOwnCandidatesIdempotent).toHaveBeenCalledTimes(1);
    const inputs = mocks.createOwnCandidatesIdempotent.mock.calls[0]![2] as {
      projectId: string;
      evidenceIds: string[];
      dedupeKey: string;
    }[];
    const byProject = (id: string) => inputs.filter((c) => c.projectId === id);
    expect(byProject('proj-1').length).toBeGreaterThan(0);
    expect(byProject('proj-2').length).toBeGreaterThan(0);
    for (const c of byProject('proj-2')) expect(c.evidenceIds).toEqual(['e-other']);
    expect(new Set(inputs.map((c) => c.dedupeKey)).size).toBe(inputs.length);
  });

  it('is idempotent: running twice yields identical dedupe keys (store skips existing)', async () => {
    mocks.listOwnGithubRepositories.mockResolvedValue([repo()]);
    await generateCandidatesForSelectedRepos(supabase, 'user-1');
    await generateCandidatesForSelectedRepos(supabase, 'user-1');
    const keys = (i: number) =>
      (
        mocks.createOwnCandidatesIdempotent.mock.calls[i]![2] as { dedupeKey: string }[]
      ).map((c) => c.dedupeKey);
    expect(keys(0)).toEqual(keys(1));
    expect(new Set(keys(0)).size).toBe(keys(0).length);
  });
});
