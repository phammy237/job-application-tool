// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  listOwnDiscoveryFeed: vi.fn(),
  listDiscoveryLocationTokens: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnDiscoveryFeed: mocks.listOwnDiscoveryFeed,
  listDiscoveryLocationTokens: mocks.listDiscoveryLocationTokens,
}));

vi.mock('../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { default: DiscoverPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_CLIENT = { tag: 'session-scoped' };

function job(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobCatalogId: 'job-1',
    title: 'Software Engineer',
    companyName: 'Acme',
    locationText: 'New York, NY',
    normalizedWorkplaceType: 'REMOTE',
    normalizedEmploymentType: 'FULL_TIME',
    isInternship: false,
    roleFamily: 'SOFTWARE_ENGINEERING',
    firstSeenAt: new Date().toISOString(),
    matchScore: 78,
    coverage: 65,
    eligibilityStatus: 'ELIGIBLE',
    trackedApplicationId: null,
    trackedApplicationStatus: null,
    canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/1234',
    sourceUrl: null,
    applyUrl: 'https://boards.greenhouse.io/acme/jobs/1234',
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await DiscoverPage({ searchParams: Promise.resolve(searchParams) });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.listDiscoveryLocationTokens.mockResolvedValue([]);
  mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [], hasNextPage: false });
});

afterEach(() => {
  cleanup();
});

describe('DiscoverPage', () => {
  it('shows an honest empty state with no ranked jobs and no filters applied', async () => {
    await renderPage();
    expect(
      screen.getByText(
        "No ranked jobs yet. Once Career OS has scored jobs against your profile, they'll show up here.",
      ),
    ).toBeInTheDocument();
  });

  it('shows a distinct empty state when filters match nothing', async () => {
    await renderPage({ q: 'nonexistent' });
    expect(screen.getByText('No jobs match your search and filters.')).toBeInTheDocument();
  });

  it('links to the D5B settings page via an "Edit preferences" entry', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: 'Edit preferences' })).toHaveAttribute(
      'href',
      '/settings/discovery',
    );
  });

  it('renders a job card linking to its detail page', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [job()], hasNextPage: false });
    await renderPage();
    const link = screen.getByRole('link', { name: 'Software Engineer' });
    expect(link).toHaveAttribute('href', '/discover/job-1');
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
  });

  it('D7.1 (24, 27): a resolved/ATS-native job shows "Apply on employer site" as the primary card action', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/1234' })],
      hasNextPage: false,
    });
    await renderPage();
    const primary = screen.getByRole('link', { name: 'Apply on employer site →' });
    expect(primary).toHaveAttribute('href', 'https://boards.greenhouse.io/acme/jobs/1234');
    expect(screen.queryByRole('link', { name: 'Find official posting →' })).not.toBeInTheDocument();
  });

  it('D7.1 (25, 26): an unresolved job shows "Find official posting" as primary and keeps "View source" available', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [
        job({
          canonicalApplyUrl: 'https://jobright.ai/jobs/info/abc123',
          sourceUrl: 'https://jobright.ai/jobs/info/abc123',
          applyUrl: 'https://jobright.ai/jobs/info/abc123',
        }),
      ],
      hasNextPage: false,
    });
    await renderPage();
    expect(screen.getByRole('link', { name: 'Find official posting →' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View source' })).toHaveAttribute(
      'href',
      'https://jobright.ai/jobs/info/abc123',
    );
    expect(screen.queryByRole('link', { name: 'Apply on employer site →' })).not.toBeInTheDocument();
  });

  it('a canonically-classified internship shows "Internship" even when its normalizedEmploymentType is FULL_TIME, never a contradicting raw label', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ isInternship: true, normalizedEmploymentType: 'FULL_TIME' })],
      hasNextPage: false,
    });
    await renderPage();
    // "Internship"/"Full-time" both also appear as the Employment type filter's own static
    // <option> labels regardless of the fixture — assert the job card contributes a SECOND
    // "Internship" occurrence (its own badge), while "Full-time" stays at exactly the filter's one.
    expect(screen.getAllByText('Internship')).toHaveLength(2);
    expect(screen.getAllByText('Full-time')).toHaveLength(1);
  });

  it('a non-internship job still shows its real normalizedEmploymentType label unchanged', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ isInternship: false, normalizedEmploymentType: 'FULL_TIME' })],
      hasNextPage: false,
    });
    await renderPage();
    expect(screen.getAllByText('Full-time')).toHaveLength(2);
    expect(screen.getAllByText('Internship')).toHaveLength(1);
  });

  it('shows Match, Coverage, and Eligibility as three separate labeled values, never combined', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ matchScore: 78, coverage: 65, eligibilityStatus: 'ELIGIBLE' })],
      hasNextPage: false,
    });
    await renderPage();
    expect(screen.getByText('Match')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
    // "No conflicts found" also appears as a filter-dropdown option, so at least one occurrence
    // (the result card's own badge) is what matters here.
    expect(screen.getAllByText('No conflicts found').length).toBeGreaterThan(0);
    // Never a single combined percentage/score string like "78/65" or "72% match".
    expect(document.body.textContent).not.toMatch(/\d+\s*\/\s*\d+%/);
  });

  it('never uses star-rating or pass/fail marketing language anywhere on the page', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ eligibilityStatus: 'CONFLICT' })],
      hasNextPage: false,
    });
    await renderPage();
    const text = document.body.textContent?.toLowerCase() ?? '';
    expect(text).not.toMatch(/perfect match|bad match|star rating|★/);
  });

  it('shows a "Limited job data" notice only for low-coverage results', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({
      items: [job({ jobCatalogId: 'low', coverage: 4.35 }), job({ jobCatalogId: 'high', coverage: 90 })],
      hasNextPage: false,
    });
    await renderPage();
    expect(screen.getAllByText(/Limited job data/)).toHaveLength(1);
  });

  it('passes every filter field through to listOwnDiscoveryFeed as parsed filters', async () => {
    await renderPage({
      q: 'engineer',
      role: 'SOFTWARE_ENGINEERING',
      location: 'NEW_YORK_NY',
      workplace: 'REMOTE',
      employment: 'FULL_TIME',
      eligibility: 'UNKNOWN',
      minMatch: '50',
      minCoverage: '30',
      freshness: '7',
      page: '2',
    });
    expect(mocks.listOwnDiscoveryFeed).toHaveBeenCalledWith(
      SESSION_CLIENT,
      {
        search: 'engineer',
        roleFamilies: ['SOFTWARE_ENGINEERING'],
        locationToken: 'NEW_YORK_NY',
        workplaceTypes: ['REMOTE'],
        employmentTypes: ['FULL_TIME'],
        eligibilityStatuses: ['UNKNOWN'],
        minMatch: 50,
        minCoverage: 30,
        freshnessDays: 7,
        page: 2,
      },
      { pageSize: expect.any(Number) },
    );
  });

  it('never crashes on malformed/unrecognized query params — falls back to defaults', async () => {
    await expect(
      renderPage({ role: 'NOT_A_REAL_FAMILY', page: 'abc', minMatch: 'nope' }),
    ).resolves.not.toThrow();
    expect(mocks.listOwnDiscoveryFeed).toHaveBeenCalledWith(
      SESSION_CLIENT,
      expect.objectContaining({ roleFamilies: null, page: 1, minMatch: null }),
      expect.anything(),
    );
  });

  it('shows a Next link that preserves the current filters when there is another page', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [job()], hasNextPage: true });
    await renderPage({ q: 'engineer' });
    const next = screen.getByRole('link', { name: 'Next →' });
    expect(next.getAttribute('href')).toContain('q=engineer');
    expect(next.getAttribute('href')).toContain('page=2');
  });

  it('shows a Previous link on page 2+, none on page 1', async () => {
    mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [job()], hasNextPage: false });
    await renderPage({ page: '2' });
    // Page 1 has no query params of its own, so Previous from page 2 (with no other filters
    // active) links back to the bare /discover, not /discover?page=1.
    expect(screen.getByRole('link', { name: '← Previous' })).toHaveAttribute('href', '/discover');
    cleanup();
    mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [job()], hasNextPage: false });
    await renderPage();
    expect(screen.queryByRole('link', { name: '← Previous' })).not.toBeInTheDocument();
  });

  it('populates the location filter from listDiscoveryLocationTokens', async () => {
    mocks.listDiscoveryLocationTokens.mockResolvedValue(['NEW_YORK_NY']);
    await renderPage();
    expect(screen.getByRole('option', { name: 'New York NY' })).toBeInTheDocument();
  });

  describe('D6 tracked-state integration', () => {
    it('an untracked card shows "Start application", never "View application"', async () => {
      mocks.listOwnDiscoveryFeed.mockResolvedValue({ items: [job()], hasNextPage: false });
      await renderPage();
      expect(screen.getByRole('button', { name: 'Start application' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View application' })).not.toBeInTheDocument();
    });

    it('a tracked card shows "View application" and the real status, never also "Start application"', async () => {
      mocks.listOwnDiscoveryFeed.mockResolvedValue({
        items: [job({ trackedApplicationId: 'app-1', trackedApplicationStatus: 'IN_PROGRESS' })],
        hasNextPage: false,
      });
      await renderPage();
      expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute(
        'href',
        '/applications/app-1',
      );
      expect(screen.getByText('In progress')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start application' })).not.toBeInTheDocument();
    });

    it('tracked state never changes the rendered Match/Coverage/Eligibility values', async () => {
      mocks.listOwnDiscoveryFeed.mockResolvedValue({
        items: [
          job({
            matchScore: 91,
            coverage: 84,
            eligibilityStatus: 'CONFLICT',
            trackedApplicationId: 'app-1',
            trackedApplicationStatus: 'SAVED',
          }),
        ],
        hasNextPage: false,
      });
      await renderPage();
      expect(screen.getByText('91%')).toBeInTheDocument();
      expect(screen.getByText('84%')).toBeInTheDocument();
      expect(screen.getAllByText('Possible conflict').length).toBeGreaterThan(0);
    });
  });
});
