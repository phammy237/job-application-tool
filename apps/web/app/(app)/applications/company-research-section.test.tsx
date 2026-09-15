// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOwnCompanyResearchSnapshotsForApplication: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnCompanyResearchSnapshotsForApplication:
    mocks.listOwnCompanyResearchSnapshotsForApplication,
}));

vi.mock('./research-company-button', () => ({
  ResearchCompanyButton: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}));

const { CompanyResearchSection } = await import('./company-research-section');

const SUPABASE = {} as never;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

async function renderSection() {
  const element = await CompanyResearchSection({
    supabase: SUPABASE,
    userId: USER_ID,
    applicationId: APPLICATION_ID,
  });
  render(element);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('CompanyResearchSection', () => {
  it('shows the "Research company" button and no snapshot summary when none exists', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    await renderSection();
    expect(screen.getByRole('button', { name: 'Research company' })).toBeInTheDocument();
    expect(screen.queryByText(/Last researched/)).not.toBeInTheDocument();
  });

  it('shows the latest snapshot summary and a "Refresh research" button when one exists', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: 's2',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-15T00:00:00.000Z',
        findingCount: 5,
        sourceCount: 3,
      },
    ]);
    await renderSection();
    expect(screen.getByText(/Last researched/)).toBeInTheDocument();
    expect(screen.getByText(/5 findings · 3 sources/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh research' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View research' })).toHaveAttribute(
      'href',
      `/applications/${APPLICATION_ID}/company-research`,
    );
  });

  it('mentions earlier snapshots when more than one exists', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: 's2',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-15T00:00:00.000Z',
        findingCount: 1,
        sourceCount: 1,
      },
      {
        id: 's1',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-08-30T00:00:00.000Z',
        findingCount: 1,
        sourceCount: 1,
      },
    ]);
    await renderSection();
    expect(screen.getByText(/1 earlier research snapshot/)).toBeInTheDocument();
  });

  it('never calls the research endpoint itself — the section is purely a server-side read', async () => {
    vi.stubGlobal('fetch', vi.fn());
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    await renderSection();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
