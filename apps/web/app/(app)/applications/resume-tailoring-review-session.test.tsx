// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ResumeTailoringProposal } from '@career-os/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeTailoringReviewSession } from './resume-tailoring-review-session';

const APPLICATION_ID = 'app-1';
const HEADER = { fullName: 'Ada', email: null, phone: null, location: null, links: {} };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const BASE_RESUME = {
  schemaVersion: 1,
  header: HEADER,
  education: [],
  experience: [
    {
      id: 'exp-1',
      organization: 'Acme',
      role: 'Engineer',
      location: null,
      dateRange: { start: null, end: null, isPresent: false },
      bullets: [
        { id: 'b1', text: 'Built the referral workflow', provenance: { type: 'MANUAL' } },
        { id: 'b2', text: 'Improved onboarding flow', provenance: { type: 'MANUAL' } },
      ],
    },
  ],
  projects: [],
  leadership: [],
  skills: [],
  renderOverride: null as { latex: string } | null,
};

function proposal(
  overrides: Partial<ResumeTailoringProposal> = {},
): ResumeTailoringProposal {
  return {
    baseResumeVersionId: 'version-1',
    baseResumeDisplayName: 'Master Resume',
    baseResumeVersionNumber: 2,
    jobSnapshotId: 'snapshot-1',
    requirementMappingRunId: null,
    baseResume: BASE_RESUME as ResumeTailoringProposal['baseResume'],
    customLatexOverridePresent: false,
    researchMode: 'JOB_ONLY',
    companyResearchSnapshotId: null,
    companyResearchResearchedAt: null,
    selectedResearchFindingCount: 0,
    operations: [
      {
        type: 'REWRITE_BULLET',
        bulletId: 'b1',
        entryLabel: 'Engineer at Acme',
        before: 'Built the referral workflow',
        after: 'Led the referral workflow rebuild for 5 engineers',
        groundedFacts: [{ id: 'fact-1', label: 'Led a team of 5 engineers' }],
        relevantRequirements: [
          { id: 'req-1', text: '5+ years of engineering experience' },
        ],
        companyRelevance: [],
        reason: 'Emphasizes leadership experience relevant to the role',
      },
      {
        type: 'OMIT_BULLET',
        bulletId: 'b2',
        entryLabel: 'Engineer at Acme',
        omittedText: 'Improved onboarding flow',
        companyRelevance: [],
        reason: 'Not relevant to this role',
      },
    ],
    summary: {
      rewrittenBullets: 1,
      addedBullets: 0,
      omittedBullets: 1,
      omittedEntries: 0,
      movedBullets: 0,
      movedEntries: 0,
      skillsReordered: false,
      requirementsReferenced: 1,
      researchFindingsReferenced: 0,
      operationsInfluencedByResearch: 0,
    },
    coverage: {
      totalRequirementCount: 2,
      coveredRequirementIds: ['req-1'],
      unsupportedRequirementIds: ['req-2'],
      referencedRequirementIds: ['req-1'],
      unsupportedRequirements: [{ id: 'req-2', text: 'Experience with Snowflake' }],
    },
    proposedResumeLatex: '\\documentclass{article}',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function saveButton() {
  return screen.getByRole('button', { name: /Save Tailored Resume/ });
}

describe('ResumeTailoringReviewSession', () => {
  it('defaults every operation to Pending review — never pre-accepted', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    expect(
      within(screen.getByTestId('operation-op-0')).getByText('Pending review'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('operation-op-1')).getByText('Pending review'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('Accept updates the operation status and the live preview, without any network call', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));

    expect(within(card).getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('1 accepted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Reject updates the operation status and never persists rejected text', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(within(card).getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('1 rejected')).toBeInTheDocument();
  });

  it('Accept all remaining resolves every PENDING operation without an explicit AI call', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    expect(screen.getByText('2 accepted')).toBeInTheDocument();
    expect(screen.getByText('0 pending')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Reject all remaining resolves every PENDING operation, and disables Save (no_changes)', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject all remaining' }));
    expect(screen.getByText('2 rejected')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('Edit shows before/proposal, lets the user change text, and defaults the provenance choice', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));

    const textarea = within(card).getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Custom edited bullet text' } });
    fireEvent.click(within(card).getByRole('radio', { name: 'Save as manual content' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Use this text' }));

    expect(within(card).getByText('Custom edited bullet text')).toBeInTheDocument();
    expect(within(card).getByText('Accepted')).toBeInTheDocument();
    expect(within(card).getByText(/Edited — Manual/)).toBeInTheDocument();
  });

  it('an edit kept fact-grounded that introduces an unsupported number blocks Save and shows why', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'Grew revenue by $50M' },
    });
    fireEvent.click(within(card).getByRole('radio', { name: 'Keep as fact-grounded' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Use this text' }));

    expect(within(card).getByText(/can't be saved as fact-grounded/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('Save is disabled while any operation remains PENDING', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(saveButton()).toBeDisabled(); // op-1 still pending
  });

  it('Save is disabled when there are no net changes (everything rejected)', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject all remaining' }));
    expect(screen.getByText('No changes are selected.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('requires the custom-LaTeX-override acknowledgement before Save is enabled', () => {
    const withOverride = proposal({
      customLatexOverridePresent: true,
      baseResume: {
        ...BASE_RESUME,
        renderOverride: { latex: '\\documentclass{article}' },
      } as ResumeTailoringProposal['baseResume'],
    });
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={withOverride}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(saveButton()).not.toBeDisabled();
  });

  it('coverage recomputes live: rejecting the only citing operation drops that requirement from covered', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    expect(
      screen.getByText(/requirements? represented by accepted changes/),
    ).toHaveTextContent('0 of 2');

    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(
      screen.getByText(/requirements? represented by accepted changes/),
    ).toHaveTextContent('1 of 2');
  });

  it('successfully saves and shows the success view with Studio and Back-to-Application actions', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        applicationId: APPLICATION_ID,
        resumeId: 'new-resume-id',
        resumeCreated: true,
        versionId: 'new-version-id',
        versionNumber: 1,
        displayName: "Ada's Resume -- Acme -- Engineer",
      }),
    );
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Tailored résumé saved')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Ada's Resume -- Acme -- Engineer/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Resume Studio' })).toHaveAttribute(
      'href',
      '/resumes/new-resume-id/studio',
    );
    expect(screen.getByRole('link', { name: 'Back to Application' })).toHaveAttribute(
      'href',
      `/applications/${APPLICATION_ID}`,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/resume-tailoring/save`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a stale-base error and never claims success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'stale_base_resume', currentWorkingResumeVersionId: 'v9' }),
    );
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(
        screen.getByText(/working résumé changed after this proposal was generated/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Tailored résumé saved')).not.toBeInTheDocument();
  });

  it('never calls the save endpoint on Accept/Reject/Edit — only on the explicit Save click', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    const card = screen.getByTestId('operation-op-0');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'Edited text' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Use this text' }));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('ResumeTailoringReviewSession — Phase 7H company relevance', () => {
  it('with researchMode JOB_ONLY, shows "Company research: Not used" and no company-relevance notes', () => {
    render(
      <ResumeTailoringReviewSession applicationId={APPLICATION_ID} proposal={proposal()} />,
    );
    expect(screen.getByText(/Company research: Not used/)).toBeInTheDocument();
    expect(screen.queryByText('Company relevance:')).not.toBeInTheDocument();
  });

  it('with research used, shows the researched date and selected finding count, and never implies affiliation', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal({
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: 'snapshot-1',
          companyResearchResearchedAt: '2026-09-15T12:00:00.000Z',
          selectedResearchFindingCount: 3,
        })}
      />,
    );
    expect(screen.getByText(/Company research: Sep 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/3 selected findings/)).toBeInTheDocument();
    // Never implies the candidate worked on the company's own initiative (§67).
    expect(screen.queryByText(/you worked on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your company work/i)).not.toBeInTheDocument();
  });

  it('resolves a companyRelevance citation into a readable note with a link to research, and no raw UUID', () => {
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal({
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: 'snapshot-1',
          companyResearchResearchedAt: '2026-09-15T00:00:00.000Z',
          selectedResearchFindingCount: 1,
          operations: [
            {
              type: 'REWRITE_BULLET',
              bulletId: 'b1',
              entryLabel: 'Engineer at Acme',
              before: 'Built the referral workflow',
              after: 'Led the referral workflow rebuild for 5 engineers',
              groundedFacts: [{ id: 'fact-1', label: 'Led a team of 5 engineers' }],
              relevantRequirements: [],
              companyRelevance: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  claim: 'Acme recently expanded its platform team',
                  roleRelevance: 'Directly relevant to this engineering role',
                  category: 'HIRING',
                },
              ],
              reason: 'x',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Company relevance:')).toBeInTheDocument();
    expect(
      screen.getByText(/Directly relevant to this engineering role/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/11111111-1111-4111-8111-111111111111/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View research' })).toHaveAttribute(
      'href',
      `/applications/${APPLICATION_ID}/company-research`,
    );
  });

  it('forwards the proposal\'s companyResearchSnapshotId when saving', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', applicationId: APPLICATION_ID, resumeId: 'r', resumeCreated: true, versionId: 'v', versionNumber: 1, displayName: 'x' }),
    );
    render(
      <ResumeTailoringReviewSession
        applicationId={APPLICATION_ID}
        proposal={proposal({
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: 'snapshot-1',
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all remaining' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.companyResearchSnapshotId).toBe('snapshot-1');
  });
});
