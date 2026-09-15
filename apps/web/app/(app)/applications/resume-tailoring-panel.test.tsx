// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeTailoringPanel } from './resume-tailoring-panel';

const APPLICATION_ID = 'app-1';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const HEADER = { fullName: 'Ada', email: null, phone: null, location: null, links: {} };

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
      ],
    },
  ],
  projects: [],
  leadership: [],
  skills: [],
  renderOverride: null,
};

const FULL_PROPOSAL = {
  baseResumeVersionId: 'version-1',
  baseResumeDisplayName: 'Software Engineer Resume',
  baseResumeVersionNumber: 2,
  jobSnapshotId: 'snapshot-1',
  requirementMappingRunId: null,
  baseResume: BASE_RESUME,
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
      after: 'Led the referral workflow rebuild',
      groundedFacts: [{ id: 'fact-1', label: 'Led a team of 5 engineers' }],
      relevantRequirements: [{ id: 'req-1', text: '5+ years of engineering experience' }],
      companyRelevance: [],
      reason: 'Emphasizes leadership experience relevant to the role',
    },
  ],
  summary: {
    rewrittenBullets: 1,
    addedBullets: 0,
    omittedBullets: 0,
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
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResumeTailoringPanel', () => {
  it('never calls fetch on render', () => {
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the resume-tailoring endpoint exactly once, only after the button is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/api/applications/${APPLICATION_ID}/resume-tailoring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ researchMode: 'JOB_ONLY' }),
    });
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());
  });

  it('shows a loading state while generating', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    expect(screen.getByRole('button', { name: 'Tailoring…' })).toBeDisabled();
  });

  it('renders every operation PENDING by default, with before/after and provenance — never pre-accepted', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));

    await waitFor(() =>
      expect(screen.getByText('Built the referral workflow')).toBeInTheDocument(),
    );
    expect(screen.getByText('Led the referral workflow rebuild')).toBeInTheDocument();
    expect(screen.getByText('Led a team of 5 engineers')).toBeInTheDocument();
    expect(
      screen.getAllByText('5+ years of engineering experience').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('Emphasizes leadership experience relevant to the role'),
    ).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByText('0 accepted')).toBeInTheDocument();
  });

  it('shows the custom-LaTeX-override warning and requires acknowledgement only when the base version has one', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        proposal: { ...FULL_PROPOSAL, customLatexOverridePresent: true },
      }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/custom Advanced LaTeX override/)).toBeInTheDocument(),
    );
  });

  it('never shows the override warning when the base version has no override', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText('Built the referral workflow')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/custom Advanced LaTeX override/)).not.toBeInTheDocument();
  });

  it('shows "nothing needed to change" rather than an empty list when operations is empty', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        proposal: {
          ...FULL_PROPOSAL,
          operations: [],
          summary: { ...FULL_PROPOSAL.summary, rewrittenBullets: 0 },
        },
      }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(
        screen.getByText('Nothing needed to change for this role.'),
      ).toBeInTheDocument(),
    );
  });

  it('offers a .tex download button that never triggers a fetch of its own', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Download .tex preview' }),
      ).toBeInTheDocument(),
    );
    (fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Download .tex preview' }));
    expect(fetch).not.toHaveBeenCalled();
    // Never any claim about a PDF preview or compilation.
    expect(screen.queryByText(/pdf/i)).not.toBeInTheDocument();
  });

  it('warns before discarding an in-progress review when Regenerate is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(confirm).toHaveBeenCalled();
  });

  it('shows a no_working_resume message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'no_working_resume' }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/Select a working résumé/)).toBeInTheDocument(),
    );
  });

  it('shows an unsupported_resume_format message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'unsupported_resume_format' }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/doesn't have structured content yet/)).toBeInTheDocument(),
    );
  });

  it('shows a missing_job_snapshot message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'missing_job_snapshot' }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/no saved job posting/)).toBeInTheDocument(),
    );
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'limit' }, 429),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows an error message on provider failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'AI provider error' }, 502),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText('AI provider error')).toBeInTheDocument(),
    );
  });
});

describe('ResumeTailoringPanel — Phase 7H research mode selector', () => {
  const LATEST_RESEARCH = { id: 'snapshot-1', researchedAt: '2026-09-15T00:00:00.000Z' };

  it('with no research, shows only a "job posting only" note and a link to research first — no mode radios', () => {
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    expect(screen.getByText(/Tailor using job posting only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Research company first' })).toHaveAttribute(
      'href',
      `/applications/${APPLICATION_ID}/company-research`,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('with research available, defaults to "use latest research" selected, and lets the user switch to job-only', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(
      <ResumeTailoringPanel
        applicationId={APPLICATION_ID}
        latestCompanyResearch={LATEST_RESEARCH}
      />,
    );
    const useResearch = screen.getByRole('radio', { name: /Use latest research/ });
    const jobOnly = screen.getByRole('radio', { name: 'Tailor using job posting only' });
    expect(useResearch).toBeChecked();
    expect(jobOnly).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/resume-tailoring`,
      expect.objectContaining({
        body: JSON.stringify({
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: LATEST_RESEARCH.id,
        }),
      }),
    );
  });

  it('user can switch to job-only even when research exists — never forced', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(
      <ResumeTailoringPanel
        applicationId={APPLICATION_ID}
        latestCompanyResearch={LATEST_RESEARCH}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Tailor using job posting only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/resume-tailoring`,
      expect.objectContaining({
        body: JSON.stringify({ researchMode: 'JOB_ONLY' }),
      }),
    );
  });

  it('shows a stale_company_research message with a link to research again', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'stale_company_research' }),
    );
    render(
      <ResumeTailoringPanel
        applicationId={APPLICATION_ID}
        latestCompanyResearch={LATEST_RESEARCH}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/no longer matches this application/)).toBeInTheDocument(),
    );
  });

  it('shows a research_snapshot_not_found message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'research_snapshot_not_found' }),
    );
    render(
      <ResumeTailoringPanel
        applicationId={APPLICATION_ID}
        latestCompanyResearch={LATEST_RESEARCH}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/no longer available/)).toBeInTheDocument(),
    );
  });
});
