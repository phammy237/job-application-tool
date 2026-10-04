import { describe, expect, it } from 'vitest';
import { normalizeRepository } from './normalize';
import { createProjectFromRepository, humanizeRepoName } from './project-mapping';
import type { RawRepo } from './client';

const raw: RawRepo = {
  id: 42,
  name: 'career-os_tool',
  full_name: 'octo/career-os_tool',
  description: null,
  html_url: 'https://github.com/octo/career-os_tool',
  private: true,
  fork: false,
  archived: false,
  default_branch: 'main',
  language: null,
  stargazers_count: 12,
  created_at: '2024-03-05T10:00:00Z',
  pushed_at: '2026-05-01T10:00:00Z',
  owner: { login: 'octo' },
};

describe('normalizeRepository', () => {
  it('maps raw JSON to a validated snapshot with safe defaults', () => {
    const s = normalizeRepository(raw);
    expect(s).toMatchObject({
      githubRepoId: 42,
      fullName: 'octo/career-os_tool',
      description: null,
      isPrivate: true,
      topics: [],
      languages: {},
      readmeExcerpt: null,
      prCount: 0,
      repoCreatedAt: '2024-03-05T10:00:00.000Z',
    });
  });

  it('includes detail and caps the README excerpt at 6000', () => {
    const s = normalizeRepository(raw, {
      languages: { Go: 1 },
      readme: { text: 'a'.repeat(7000), sha: 's' },
      contributors: [{ login: 'octo', contributions: 3 }],
      prCount: 4,
      commitCount: 9,
      etag: 'W/"x"',
    });
    expect(s.readmeExcerpt).toHaveLength(6000);
    expect(s).toMatchObject({
      readmeSha: 's',
      prCount: 4,
      commitCount: 9,
      etag: 'W/"x"',
    });
  });
});

describe('createProjectFromRepository', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  it('creates an UNAPPROVED, PRIVATE project and never approves or publishes', () => {
    const p = createProjectFromRepository(
      { ...normalizeRepository(raw), topics: ['cli'] },
      now,
    );
    expect(p).toMatchObject({
      name: 'Career Os Tool',
      url: raw.html_url,
      startDate: '2024-03-05',
      endDate: null,
      origin: 'GITHUB',
      status: 'ACTIVE',
      tags: ['cli'],
      userApproved: false,
      approvedForApplications: false,
      visibleOnPublicProfile: false,
      visibility: 'PRIVATE',
    });
  });

  it('is COMPLETED when not pushed within 12 months', () => {
    const p = createProjectFromRepository(
      normalizeRepository({ ...raw, pushed_at: '2025-01-01T00:00:00Z' }),
      now,
    );
    expect(p.status).toBe('COMPLETED');
  });

  it('humanizes names', () => {
    expect(humanizeRepoName('o/my-cool.repo')).toBe('My Cool Repo');
    expect(humanizeRepoName('o/iOS-app')).toBe('iOS App');
  });
});
