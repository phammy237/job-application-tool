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

const FULL_PROPOSAL = {
  baseResumeVersionId: 'version-1',
  baseResumeDisplayName: 'Software Engineer Resume',
  baseResumeVersionNumber: 2,
  customLatexOverridePresent: false,
  operations: [
    {
      type: 'REWRITE_BULLET',
      bulletId: 'b1',
      entryLabel: 'Engineer at Acme',
      before: 'Built the referral workflow',
      after: 'Led the referral workflow rebuild',
      groundedFacts: [{ id: 'fact-1', label: 'Led a team of 5 engineers' }],
      relevantRequirements: [{ id: 'req-1', text: '5+ years of engineering experience' }],
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
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResumeTailoringPanel', () => {
  it('never calls fetch on render', () => {
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the resume-tailoring endpoint exactly once, only after the button is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/resume-tailoring`,
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());
  });

  it('shows a loading state while generating', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    expect(screen.getByRole('button', { name: 'Tailoring…' })).toBeDisabled();
  });

  it('renders the summary, coverage, before/after, provenance, and an explicit "nothing saved" note on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));

    await waitFor(() => expect(screen.getByText(/Nothing has been saved yet/)).toBeInTheDocument());
    expect(screen.getByText(/Software Engineer Resume/)).toBeInTheDocument();
    expect(screen.getByText('1 rewritten')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 requirement/)).toBeInTheDocument();
    expect(screen.getByText(/No grounded evidence found for:/)).toBeInTheDocument();
    expect(screen.getByText('Experience with Snowflake')).toBeInTheDocument();
    expect(screen.getByText('Built the referral workflow')).toBeInTheDocument();
    expect(screen.getByText('Led the referral workflow rebuild')).toBeInTheDocument();
    expect(
      screen.getByText('Emphasizes leadership experience relevant to the role'),
    ).toBeInTheDocument();
  });

  it('shows the custom-LaTeX-override warning only when the base version has one', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        proposal: { ...FULL_PROPOSAL, customLatexOverridePresent: true },
      }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/custom Advanced LaTeX override/)).toBeInTheDocument(),
    );
  });

  it('never shows the override warning when the base version has no override', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText('1 rewritten')).toBeInTheDocument());
    expect(screen.queryByText(/custom Advanced LaTeX override/)).not.toBeInTheDocument();
  });

  it('shows "nothing needed to change" rather than an empty list when operations is empty', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        proposal: { ...FULL_PROPOSAL, operations: [], summary: { ...FULL_PROPOSAL.summary, rewrittenBullets: 0 } },
      }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText('Nothing needed to change for this role.')).toBeInTheDocument(),
    );
  });

  it('offers a .tex download button that never triggers a fetch of its own', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', proposal: FULL_PROPOSAL }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download .tex preview' })).toBeInTheDocument(),
    );
    (fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Download .tex preview' }));
    expect(fetch).not.toHaveBeenCalled();
    // Never any claim about a PDF preview or compilation.
    expect(screen.queryByText(/pdf/i)).not.toBeInTheDocument();
  });

  it('shows a no_working_resume message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ status: 'no_working_resume' }));
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText(/Select a working résumé/)).toBeInTheDocument());
  });

  it('shows an unsupported_resume_format message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'unsupported_resume_format' }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() =>
      expect(screen.getByText(/doesn't have structured content yet/)).toBeInTheDocument(),
    );
  });

  it('shows a missing_job_snapshot message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'missing_job_snapshot' }),
    );
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText(/no saved job posting/)).toBeInTheDocument());
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ error: 'limit' }, 429));
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows an error message on provider failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(jsonResponse({ error: 'AI provider error' }, 502));
    render(<ResumeTailoringPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tailor resume for this job' }));
    await waitFor(() => expect(screen.getByText('AI provider error')).toBeInTheDocument());
  });
});
