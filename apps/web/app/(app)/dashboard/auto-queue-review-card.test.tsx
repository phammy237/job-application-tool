// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '@career-os/shared';
import { AutoQueueReviewCard } from './auto-queue-review-card';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    userId: 'user-1',
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
    jobCatalogId: 'catalog-1',
    autoTracked: false,
    autoQueued: true,
    autoQueueStatus: 'PENDING_REVIEW',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockRefresh.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AutoQueueReviewCard', () => {
  it('renders the company/title and, when given a match score, the Match/Coverage/Eligibility badges', () => {
    render(
      <AutoQueueReviewCard
        application={application()}
        matchScore={{
          id: 'score-1',
          userId: 'user-1',
          jobCatalogId: 'catalog-1',
          matchScore: 82,
          coverage: 75,
          eligibilityStatus: 'ELIGIBLE',
          scoreComponents: [],
          eligibilityChecks: [],
          rankingVersion: 'v1',
          featureVersion: 'v1',
          eligibilityVersion: 'v1',
          computedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Acme — Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('renders without the Match/Coverage badges when no score is given', () => {
    render(<AutoQueueReviewCard application={application()} />);
    expect(screen.getByText('Acme — Backend Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Match')).not.toBeInTheDocument();
  });

  it('posts KEEP and refreshes on success', async () => {
    const mockFetch = vi.fn().mockReturnValue(jsonResponse({ application: application() }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AutoQueueReviewCard application={application()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/applications/app-1/auto-queue-review',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'KEEP' }),
      }),
    );
  });

  it('posts DISMISS and shows an error message on failure, without refreshing', async () => {
    const mockFetch = vi.fn().mockReturnValue(jsonResponse({ error: 'Application not found' }, 404));
    vi.stubGlobal('fetch', mockFetch);

    render(<AutoQueueReviewCard application={application()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.getByText('Application not found')).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
