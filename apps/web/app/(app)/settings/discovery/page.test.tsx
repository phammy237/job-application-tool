// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  getOrCreateOwnScoringProfile: vi.fn(),
  getOrCreateOwnEligibilityProfile: vi.fn(),
  listDiscoveryLocationTokens: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOrCreateOwnScoringProfile: mocks.getOrCreateOwnScoringProfile,
  getOrCreateOwnEligibilityProfile: mocks.getOrCreateOwnEligibilityProfile,
  listDiscoveryLocationTokens: mocks.listDiscoveryLocationTokens,
}));
vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { default: DiscoverySettingsPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_CLIENT = { tag: 'session-scoped' };

const SCORING_PROFILE = {
  userId: USER_ID,
  profileVersion: 'v1',
  preset: 'CUSTOM' as const,
  criteriaWeights: {
    ROLE_FIT: 8,
    COMPETENCY_FIT: 6,
    SENIORITY_FIT: 0,
    LOCATION_FIT: 5,
    WORK_MODE_FIT: 7,
    EMPLOYMENT_TYPE_FIT: 3,
    OBSERVED_FRESHNESS: 2,
  },
  rolePreferences: { SOFTWARE_ENGINEERING: 10 },
  seniorityPreferences: {},
  locationPreferences: {},
  workModePreferences: {},
  employmentTypePreferences: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ELIGIBILITY_PROFILE = {
  userId: USER_ID,
  currentlyAuthorizedToWork: null,
  requiresSponsorshipNow: null,
  requiresSponsorshipFuture: null,
  isUsCitizen: null,
  hasActiveSecurityClearance: null,
  eligibleToObtainSecurityClearance: null,
  graduationYear: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renderPage() {
  const element = await DiscoverySettingsPage();
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.getOrCreateOwnScoringProfile.mockResolvedValue(SCORING_PROFILE);
  mocks.getOrCreateOwnEligibilityProfile.mockResolvedValue(ELIGIBILITY_PROFILE);
  mocks.listDiscoveryLocationTokens.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('DiscoverySettingsPage', () => {
  it('renders the page heading and a link back to /discover', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Discovery preferences' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Discover' })).toHaveAttribute(
      'href',
      '/discover',
    );
  });

  it('loads the profiles via the get-or-create functions, scoped to the session client and verified user', async () => {
    await renderPage();
    expect(mocks.getOrCreateOwnScoringProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID);
    expect(mocks.getOrCreateOwnEligibilityProfile).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID);
  });

  it('uses the canonical D4 get-or-create behavior — never a separate frontend default', async () => {
    // getOrCreateOwnScoringProfile/getOrCreateOwnEligibilityProfile are the same functions the D4
    // CLI uses; this page never constructs its own default profile shape — it only ever renders
    // whatever those functions returned.
    await renderPage();
    expect(screen.getByRole('spinbutton', { name: /Role fit weight/i })).toHaveValue(8);
  });

  it('passes the loaded values into the form (a rated role preference is visible)', async () => {
    await renderPage();
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
  });
});
