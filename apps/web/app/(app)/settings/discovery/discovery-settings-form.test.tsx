// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryEligibilityProfile, DiscoveryScoringProfile } from '@career-os/shared';
import { DiscoverySettingsForm } from './discovery-settings-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const USER_ID = '22222222-2222-4222-8222-222222222222';

function scoringProfile(overrides: Partial<DiscoveryScoringProfile> = {}): DiscoveryScoringProfile {
  return {
    userId: USER_ID,
    profileVersion: 'v1',
    preset: 'CUSTOM',
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
    workModePreferences: { REMOTE: 10 },
    employmentTypePreferences: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function eligibilityProfile(
  overrides: Partial<DiscoveryEligibilityProfile> = {},
): DiscoveryEligibilityProfile {
  return {
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
    ...overrides,
  };
}

function renderForm(overrides: {
  scoring?: DiscoveryScoringProfile;
  eligibility?: DiscoveryEligibilityProfile;
} = {}) {
  render(
    <DiscoverySettingsForm
      initialScoringProfile={overrides.scoring ?? scoringProfile()}
      initialEligibilityProfile={overrides.eligibility ?? eligibilityProfile()}
      locationTokens={['NEW_YORK_NY', 'SAN_FRANCISCO_CA']}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiscoverySettingsForm', () => {
  it('populates the form from the initial profiles exactly', () => {
    renderForm();
    expect(screen.getByRole('spinbutton', { name: /Role fit weight/i })).toHaveValue(8);
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
  });

  it('Save starts disabled — nothing has changed yet', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('editing a criterion weight enables Save and shows the unsaved-changes hint', () => {
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
  });

  it('posts the current scoring and eligibility state to /api/discovery/settings on save', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      jsonResponse({
        scoringChanged: true,
        eligibilityChanged: false,
        recompute: { attempted: true, succeeded: true, jobsConsidered: 10, jobsScored: 9, jobsExcludedByLocationPreference: 1 },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);
    renderForm();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/discovery/settings');
    const body = JSON.parse(init.body as string);
    expect(body.scoring.criteriaWeights.ROLE_FIT).toBe(4);
    expect(body.eligibility).toBeDefined();
  });

  it('shows the scoring-only success message and count, with a link back to /discover', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse({
          scoringChanged: true,
          eligibilityChanged: false,
          recompute: { attempted: true, succeeded: true, jobsConsidered: 1371, jobsScored: 1326, jobsExcludedByLocationPreference: 45 },
        }),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText('Your job matches have been updated.')).toBeInTheDocument(),
    );
    expect(screen.getByText(/1326 jobs re-ranked/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View updated jobs' })).toHaveAttribute(
      'href',
      '/discover',
    );
  });

  it('shows the eligibility-only success message, never claiming Match was re-ranked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse({
          scoringChanged: false,
          eligibilityChanged: true,
          recompute: { attempted: true, succeeded: true, jobsConsidered: 10, jobsScored: 10, jobsExcludedByLocationPreference: 0 },
        }),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText('US citizen'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText('Your eligibility results have been updated.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Your job matches have been updated.')).not.toBeInTheDocument();
  });

  it('shows the combined message when both profiles changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse({
          scoringChanged: true,
          eligibilityChanged: true,
          recompute: { attempted: true, succeeded: true, jobsConsidered: 10, jobsScored: 10, jobsExcludedByLocationPreference: 0 },
        }),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('US citizen'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText('Your discovery results have been updated.')).toBeInTheDocument(),
    );
  });

  it('a recompute failure shows the honest server error, and never shows "View updated jobs"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse(
          {
            scoringChanged: true,
            eligibilityChanged: false,
            recompute: { attempted: true, succeeded: false },
            error: 'Your preferences were saved, but re-ranking your jobs failed.',
          },
          502,
        ),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        screen.getByText('Your preferences were saved, but re-ranking your jobs failed.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'View updated jobs' })).not.toBeInTheDocument();
  });

  it('a network failure shows a generic error and never crashes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        screen.getByText(/Could not save your preferences\. Please check your connection/),
      ).toBeInTheDocument(),
    );
  });

  it('Save disables again after a successful save (dirty state resets to the new baseline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse({
          scoringChanged: true,
          eligibilityChanged: false,
          recompute: { attempted: true, succeeded: true, jobsConsidered: 10, jobsScored: 10, jobsExcludedByLocationPreference: 0 },
        }),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Role fit weight/i }), {
      target: { value: '4' },
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  });

  it('never renders eligibility as affecting Match, or Match as affecting Eligibility, in its own section copy', () => {
    renderForm();
    expect(
      screen.getByText('These preferences control how jobs are ranked. They do not affect eligibility.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Eligibility settings are used to identify stated conflicts in job postings. They do not affect your Match score.',
      ),
    ).toBeInTheDocument();
  });

  it('never overclaims eligibility ("you qualify"/"you can work here") anywhere on the page', () => {
    renderForm();
    const text = document.body.textContent?.toLowerCase() ?? '';
    expect(text).not.toMatch(/you qualify|you can work here|this employer accepts you/);
  });
});
