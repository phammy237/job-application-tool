// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  getOwnApplication: vi.fn(),
  listOwnCompanyResearchSnapshotsForApplication: vi.fn(),
  getOwnCompanyResearchSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  listOwnCompanyResearchSnapshotsForApplication:
    mocks.listOwnCompanyResearchSnapshotsForApplication,
  getOwnCompanyResearchSnapshot: mocks.getOwnCompanyResearchSnapshot,
}));
vi.mock('../../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../../research-company-button', () => ({
  ResearchCompanyButton: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}));

const CompanyResearchPage = (await import('./page')).default;

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_ID = '55555555-5555-4555-8555-555555555555';

async function renderPage(searchParams: { snapshot?: string } = {}) {
  const element = await CompanyResearchPage({
    params: Promise.resolve({ id: APPLICATION_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({});
  mocks.getOwnApplication.mockResolvedValue({
    id: APPLICATION_ID,
    company: 'Acme',
    title: 'Engineer',
  });
});

afterEach(() => cleanup());

describe('CompanyResearchPage', () => {
  it('calls notFound when the application is not owned/does not exist', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows an empty state with a "Research company" button when there is no research yet', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText('No research yet for this application.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research company' })).toBeInTheDocument();
  });

  it('renders the latest snapshot by default: summary, findings with numbered citations, and sources', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: 's1',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-15T00:00:00.000Z',
        findingCount: 1,
        sourceCount: 1,
      },
    ]);
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue({
      id: 's1',
      researchedAt: '2026-09-15T00:00:00.000Z',
      sources: [
        {
          id: SOURCE_ID,
          url: 'https://acme.com/news',
          title: 'Acme News',
          publisher: 'acme.com',
          sourceType: 'OFFICIAL_NEWSROOM',
          publishedAt: '2026-09-10T00:00:00.000Z',
          retrievedAt: '2026-09-15T00:00:00.000Z',
          evidenceExcerpt: null,
          contentHash: null,
          canonicalUrl: null,
        },
      ],
      findings: [
        {
          id: 'f1',
          category: 'PRODUCT',
          claim: 'Acme launched a new AI product.',
          roleRelevance: 'Directly relevant to this PM role.',
          requirementIds: ['req-1'],
          sources: [
            {
              id: SOURCE_ID,
              url: 'https://acme.com/news',
              title: 'Acme News',
              publisher: 'acme.com',
              sourceType: 'OFFICIAL_NEWSROOM',
              publishedAt: '2026-09-10T00:00:00.000Z',
              retrievedAt: '2026-09-15T00:00:00.000Z',
              evidenceExcerpt: null,
              contentHash: null,
              canonicalUrl: null,
            },
          ],
        },
      ],
    });

    await renderPage();
    expect(
      screen.getAllByText(/Acme launched a new AI product\./).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('Directly relevant to this PM role.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme News' })).toHaveAttribute(
      'href',
      'https://acme.com/news',
    );
    // Never a raw UUID shown to the user.
    expect(screen.queryByText(SOURCE_ID)).not.toBeInTheDocument();
    expect(screen.getByText(/Relevant to 1 job requirement/)).toBeInTheDocument();
  });

  it('lists previous snapshots as links carrying ?snapshot=<id>', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: 's2',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-15T00:00:00.000Z',
        findingCount: 0,
        sourceCount: 0,
      },
      {
        id: 's1',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-08-30T00:00:00.000Z',
        findingCount: 0,
        sourceCount: 0,
      },
    ]);
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue({
      id: 's2',
      researchedAt: '2026-09-15T00:00:00.000Z',
      sources: [],
      findings: [],
    });

    await renderPage();
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.includes('?snapshot='));
    expect(
      links.some(
        (l) =>
          l.getAttribute('href') ===
          `/applications/${APPLICATION_ID}/company-research?snapshot=s1`,
      ),
    ).toBe(true);
  });

  it('never calls the research generation endpoint itself — this page only reads', async () => {
    vi.stubGlobal('fetch', vi.fn());
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    await renderPage();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
