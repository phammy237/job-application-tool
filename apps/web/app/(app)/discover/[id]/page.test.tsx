// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  getOwnDiscoveryFeedJobDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@career-os/database', () => ({
  getOwnDiscoveryFeedJobDetail: mocks.getOwnDiscoveryFeedJobDetail,
}));

vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

const { default: DiscoverJobDetailPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_CLIENT = { tag: 'session-scoped' };

const BASE_JOB = {
  id: JOB_ID,
  sourceId: '44444444-4444-4444-8444-444444444444',
  sourceJobId: 'ext-1',
  companyName: 'Acme',
  title: 'Software Engineer',
  normalizedTitle: 'software engineer',
  locationText: 'New York, NY',
  normalizedLocation: 'new york, ny',
  city: 'New York',
  stateRegion: 'NY',
  country: 'US',
  workplaceType: 'REMOTE',
  employmentType: 'Full-time',
  description: 'desc',
  responsibilities: null,
  qualifications: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  applyUrl: 'https://example.com/apply',
  sourceUrl: 'https://example.com/jobs/1',
  canonicalApplyUrl: null,
  dedupeFingerprint: 'fp',
  postedAt: null,
  sourceUpdatedAt: null,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  contentUpdatedAt: '2026-01-01T00:00:00.000Z',
  consecutiveMisses: 0,
  status: 'ACTIVE',
  closedAt: null,
  contentHash: 'hash',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_FEATURES = {
  id: 'feat-1',
  jobCatalogId: JOB_ID,
  contentHashAtExtraction: 'hash',
  plainTextDescription: 'We build things.',
  roleFamily: 'SOFTWARE_ENGINEERING',
  seniority: 'MID',
  isInternship: false,
  isNewGrad: false,
  normalizedEmploymentType: 'FULL_TIME',
  normalizedWorkplaceType: 'REMOTE',
  locationTokens: ['NEW_YORK_NY'],
  extractedCompetencyCodes: [],
  requiredYearsMin: null,
  requiredYearsMax: null,
  graduationYearMin: null,
  graduationYearMax: null,
  sponsorshipSignal: 'UNKNOWN',
  citizenshipRequirement: 'UNKNOWN',
  clearanceRequirement: 'UNKNOWN',
  workAuthorizationRequirement: 'UNKNOWN',
  evidence: {},
  featureVersion: 'd4-features-v1',
  computedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_MATCH_SCORE = {
  id: 'score-1',
  userId: USER_ID,
  jobCatalogId: JOB_ID,
  matchScore: 78,
  coverage: 65,
  eligibilityStatus: 'ELIGIBLE',
  scoreComponents: [
    { criterion: 'ROLE_FIT', weight: 8, known: true, fit: 0.9 },
    { criterion: 'COMPETENCY_FIT', weight: 5, known: false, fit: null },
    { criterion: 'LOCATION_FIT', weight: 0, known: false, fit: null },
  ],
  eligibilityChecks: [],
  rankingVersion: 'd4-ranking-v1',
  featureVersion: 'd4-features-v1',
  eligibilityVersion: 'd4-eligibility-v1',
  computedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function renderPage() {
  const element = await DiscoverJobDetailPage({ params: Promise.resolve({ id: JOB_ID }) });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
});

afterEach(() => {
  cleanup();
});

describe('DiscoverJobDetailPage', () => {
  it('renders job identity', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Software Engineer' })).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
  });

  it('calls notFound when the job does not exist (never leaking existence)', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('scopes the lookup to the calling user, never a client-supplied id', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    expect(mocks.getOwnDiscoveryFeedJobDetail).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      JOB_ID,
    );
  });

  it('shows an honest "not yet scored" state instead of fabricating a score', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: null,
    });
    await renderPage();
    expect(
      screen.getByText("Career OS hasn't scored this job against your profile yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Match')).not.toBeInTheDocument();
  });

  it('renders the Match breakdown, omitting disabled (weight 0) criteria', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    expect(screen.getByText('Role fit')).toBeInTheDocument();
    expect(screen.getByText('90% fit')).toBeInTheDocument();
    expect(screen.getByText('Skills & competencies')).toBeInTheDocument();
    expect(screen.getByText('Not evaluated for this posting')).toBeInTheDocument();
    // LOCATION_FIT has weight 0 (disabled by the user's own profile) — never shown at all.
    expect(screen.queryByText('Location fit')).not.toBeInTheDocument();
  });

  it('renders each eligibility check with its explanation and highlights a CONFLICT', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: {
        ...BASE_MATCH_SCORE,
        eligibilityStatus: 'CONFLICT',
        eligibilityChecks: [
          {
            type: 'SPONSORSHIP',
            status: 'CONFLICT',
            reasonCode: 'SPONSORSHIP_NOT_AVAILABLE_BUT_REQUIRED',
            explanation:
              'The posting states it does not provide sponsorship, but your profile indicates you require sponsorship now or in the future.',
            evidenceText: 'No visa sponsorship available.',
            sourceField: 'description',
          },
        ],
      },
    });
    await renderPage();
    expect(screen.getByText('Sponsorship')).toBeInTheDocument();
    expect(
      screen.getByText(/does not provide sponsorship, but your profile indicates/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No visa sponsorship available\./)).toBeInTheDocument();
    expect(screen.getAllByText('Possible conflict').length).toBeGreaterThan(0);
  });

  it('shows the disclaimer that Career OS cannot determine actual employer decisions', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: {
        ...BASE_MATCH_SCORE,
        eligibilityChecks: [
          {
            type: 'SPONSORSHIP',
            status: 'ELIGIBLE',
            reasonCode: 'SPONSORSHIP_AVAILABLE',
            explanation: "The posting states sponsorship is available.",
            evidenceText: null,
            sourceField: 'description',
          },
        ],
      },
    });
    await renderPage();
    expect(
      screen.getByText(/Career OS cannot determine the employer's actual hiring decision/),
    ).toBeInTheDocument();
  });

  it('shows a distinct message when no eligibility checks applied at all', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: { ...BASE_MATCH_SCORE, eligibilityChecks: [] },
    });
    await renderPage();
    expect(screen.getByText(/None of the eligibility checks Career OS runs/)).toBeInTheDocument();
  });

  it('links "View original posting" to the safe source URL', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: BASE_JOB,
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    const link = screen.getByRole('link', { name: 'View original posting →' });
    expect(link).toHaveAttribute('href', 'https://example.com/jobs/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to the apply URL and never renders an unsafe source URL', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: { ...BASE_JOB, sourceUrl: 'http://localhost:8080/internal', applyUrl: 'https://example.com/apply' },
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    const link = screen.getByRole('link', { name: 'View original posting →' });
    expect(link).toHaveAttribute('href', 'https://example.com/apply');
  });

  it('shows a closed-posting notice for a CLOSED job', async () => {
    mocks.getOwnDiscoveryFeedJobDetail.mockResolvedValue({
      job: { ...BASE_JOB, status: 'CLOSED' },
      features: BASE_FEATURES,
      matchScore: BASE_MATCH_SCORE,
    });
    await renderPage();
    expect(screen.getByText('This posting appears closed')).toBeInTheDocument();
  });
});
