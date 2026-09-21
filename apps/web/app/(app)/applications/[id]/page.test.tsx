// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  getOwnApplication: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  getOwnResumeVersion: vi.fn(),
  listApplicationEvents: vi.fn(),
  listOwnCompanyResearchSnapshotsForApplication: vi.fn(),
  listOwnRelevantStatusChangeEventsForApplication: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  getOwnResumeVersion: mocks.getOwnResumeVersion,
  listApplicationEvents: mocks.listApplicationEvents,
  listOwnCompanyResearchSnapshotsForApplication: mocks.listOwnCompanyResearchSnapshotsForApplication,
  listOwnRelevantStatusChangeEventsForApplication: mocks.listOwnRelevantStatusChangeEventsForApplication,
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

// Every sub-panel gets its own dedicated test coverage elsewhere — stubbed here so this page test
// stays focused on the page's own D6 provenance rendering, matching this repo's established
// convention for large composed pages (see network/[id]/page.test.tsx).
vi.mock('../actions', () => ({ changeApplicationStatus: vi.fn(), updateApplicationNotes: vi.fn() }));
vi.mock('../company-research-section', () => ({ CompanyResearchSection: () => null }));
vi.mock('../delete-application-button', () => ({ DeleteApplicationButton: () => null }));
vi.mock('../follow-up-draft-panel', () => ({ FollowUpDraftPanel: () => null }));
vi.mock('../interview-prep-panel', () => ({ InterviewPrepPanel: () => null }));
vi.mock('../mark-applied-panel', () => ({ MarkAppliedPanel: () => null }));
vi.mock('../people-section', () => ({ PeopleSection: () => null }));
vi.mock('../requirement-analysis-panel', () => ({ RequirementAnalysisPanel: () => null }));
vi.mock('../resume-section', () => ({ ResumeSection: () => null }));
vi.mock('../resume-tailoring-panel', () => ({ ResumeTailoringPanel: () => null }));
vi.mock('../revert-event-button', () => ({ RevertEventButton: () => null }));
vi.mock('../submission-packet-section', () => ({ SubmissionPacketSection: () => null }));

const { default: ApplicationDetailPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_CATALOG_ID = '55555555-5555-4555-8555-555555555555';
const SESSION_CLIENT = { tag: 'session-scoped' };

const BASE_APPLICATION = {
  id: APPLICATION_ID,
  userId: USER_ID,
  jobId: null,
  resumeId: null,
  company: 'Acme',
  title: 'Backend Engineer',
  status: 'SAVED',
  notes: null,
  appliedAt: null,
  location: null,
  sourceUrl: null,
  canonicalUrl: null,
  atsProvider: null,
  externalId: null,
  autofillSummary: null,
  unresolvedFields: null,
  jobSnapshotId: null,
  submissionPacketId: null,
  workingResumeVersionId: null,
  jobCatalogId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renderPage() {
  const element = await ApplicationDetailPage({ params: Promise.resolve({ id: APPLICATION_ID }) });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.listApplicationEvents.mockResolvedValue([]);
  mocks.getOwnJobSnapshot.mockResolvedValue(null);
  mocks.listOwnRelevantStatusChangeEventsForApplication.mockResolvedValue([]);
  mocks.getOwnResumeVersion.mockResolvedValue(null);
  mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('ApplicationDetailPage — D6 discovery provenance', () => {
  it('opens the resolved employer posting while retaining Jobright as a separate source', async () => {
    mocks.getOwnApplication.mockResolvedValue({
      ...BASE_APPLICATION,
      jobCatalogId: JOB_CATALOG_ID,
      sourceUrl: 'https://jobright.ai/jobs/info/123',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/123',
    });
    await renderPage();
    expect(screen.getByRole('link', { name: 'Apply on employer site' }))
      .toHaveAttribute('href', 'https://boards.greenhouse.io/acme/jobs/123');
    expect(screen.getByRole('link', { name: 'View source' }))
      .toHaveAttribute('href', 'https://jobright.ai/jobs/info/123');
  });

  it.each([null, 'https://jobright.ai/jobs/info/123'])('offers official posting search for unresolved legacy applications (%s)', async (canonicalUrl) => {
    mocks.getOwnApplication.mockResolvedValue({
      ...BASE_APPLICATION, jobCatalogId: JOB_CATALOG_ID,
      sourceUrl: 'https://jobright.ai/jobs/info/123', canonicalUrl,
    });
    await renderPage();
    expect(screen.queryByRole('link', { name: 'Apply on employer site' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find official posting' })).toHaveAttribute(
      'href', expect.stringContaining('https://www.google.com/search?'),
    );
    expect(screen.getByRole('link', { name: 'View source' })).toHaveAttribute('href', 'https://jobright.ai/jobs/info/123');
  });

  it('preserves the original posting link for manually saved applications', async () => {
    mocks.getOwnApplication.mockResolvedValue({ ...BASE_APPLICATION, sourceUrl: 'https://careers.example.com/job/123' });
    await renderPage();
    expect(screen.getByRole('link', { name: 'Original job posting' })).toHaveAttribute('href', 'https://careers.example.com/job/123');
  });

  it('shows no discovery provenance for an application with no catalog linkage', async () => {
    mocks.getOwnApplication.mockResolvedValue(BASE_APPLICATION);
    await renderPage();
    expect(screen.queryByText(/Discovered through Career OS/)).not.toBeInTheDocument();
  });

  it('shows "Discovered through Career OS" with a link back to /discover/[id] when jobCatalogId is set', async () => {
    mocks.getOwnApplication.mockResolvedValue({ ...BASE_APPLICATION, jobCatalogId: JOB_CATALOG_ID });
    await renderPage();
    const link = screen.getByRole('link', { name: 'View discovery details' });
    expect(link).toHaveAttribute('href', `/discover/${JOB_CATALOG_ID}`);
    expect(screen.getByText(/Discovered through Career OS/)).toBeInTheDocument();
  });

  it('never renders Match, Coverage, or a numeric discovery score anywhere on the page', async () => {
    mocks.getOwnApplication.mockResolvedValue({ ...BASE_APPLICATION, jobCatalogId: JOB_CATALOG_ID });
    await renderPage();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Match\s*\d|Coverage\s*\d/);
  });

  it('renders a readable DISCOVERY_HANDOFF timeline entry instead of a blank status line', async () => {
    mocks.getOwnApplication.mockResolvedValue({ ...BASE_APPLICATION, jobCatalogId: JOB_CATALOG_ID });
    mocks.listApplicationEvents.mockResolvedValue([
      {
        id: 'event-1',
        userId: USER_ID,
        applicationId: APPLICATION_ID,
        eventType: 'DISCOVERY_HANDOFF',
        fromStatus: null,
        toStatus: null,
        source: 'USER',
        emailSignalId: null,
        metadata: {
          jobCatalogId: JOB_CATALOG_ID,
          sourceType: 'GREENHOUSE',
          matchScore: 80,
          coverage: 70,
          eligibilityStatus: 'ELIGIBLE',
          rankingVersion: 'd4-ranking-v1',
          featureVersion: 'd4-features-v1',
          eligibilityVersion: 'd4-eligibility-v1',
        },
        revertedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await renderPage();
    expect(screen.getByText('Discovered through Career OS Discovery')).toBeInTheDocument();
  });
});
