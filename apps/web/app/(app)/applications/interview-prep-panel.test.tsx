// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewPrepPanel } from './interview-prep-panel';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const APPLICATION_ID = 'app-1';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const FULL_PREP = {
  rolePriorities: [
    {
      requirement: '5 years of experience',
      importance: 'REQUIRED',
      sourceRequirementId: null,
      companyRelevance: [],
    },
  ],
  evidenceToEmphasize: [
    { theme: 'Kubernetes', sourceFactIds: [], summary: 'Led a migration.', companyRelevance: [] },
  ],
  starStoryPrompts: [
    {
      competency: 'Leadership',
      sourceFactIds: [],
      prompt: 'Describe leading the migration.',
      companyRelevance: [],
    },
  ],
  possibleQuestions: [
    {
      question: 'How do you approach scaling?',
      rationale: 'Role emphasizes scale.',
      sourceRequirementIds: [],
      companyRelevance: [],
    },
  ],
  questionsToAsk: [
    {
      question: 'What does success look like in 6 months?',
      rationale: 'Shows initiative.',
      companyRelevance: [],
    },
  ],
  gapsToPrepare: [
    {
      requirement: 'AWS certification',
      sourceRequirementId: null,
      note: 'No approved fact covers this.',
      companyRelevance: [],
    },
  ],
  submittedAnswersToReview: [{ fieldLabel: 'Why us?', answerText: 'Because I love it.' }],
  provenanceSummary: 'Based on 6 job requirements and 8 approved profile facts.',
  usedCurrentRequirementMapping: true,
  researchMode: 'JOB_ONLY',
  companyResearchSnapshotId: null,
  companyResearchResearchedAt: null,
  selectedResearchFindingCount: 0,
  researchFindingsReferenced: 0,
  itemsInfluencedByResearch: 0,
};

beforeEach(() => {
  mocks.refresh.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InterviewPrepPanel', () => {
  it('never calls fetch on render', () => {
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the interview-prep endpoint only after "Generate interview prep" is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));

    expect(fetch).toHaveBeenCalledWith(`/api/applications/${APPLICATION_ID}/interview-prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ researchMode: 'JOB_ONLY' }),
    });
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());
  });

  it('shows a loading state while generating', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  });

  it('renders every structured section and the provenance summary on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));

    await waitFor(() =>
      expect(screen.getByText(/Based on 6 job requirements/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Role priorities')).toBeInTheDocument();
    expect(screen.getByText('What to emphasize')).toBeInTheDocument();
    expect(screen.getByText('STAR stories to prepare')).toBeInTheDocument();
    expect(screen.getByText('Potential questions to prepare for')).toBeInTheDocument();
    expect(screen.getByText('Questions to ask')).toBeInTheDocument();
    expect(screen.getByText('Gaps to prepare')).toBeInTheDocument();
    expect(screen.getByText('Answers you already submitted')).toBeInTheDocument();
    // Never a claim about a real, known interview question.
    expect(screen.queryByText(/they will ask/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Possible questions$/)).not.toBeInTheDocument();
  });

  it('omits a section entirely when it is empty, rather than rendering an empty group', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        prep: { ...FULL_PREP, gapsToPrepare: [], submittedAnswersToReview: [] },
      }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() => expect(screen.getByText('Role priorities')).toBeInTheDocument());
    expect(screen.queryByText('Gaps to prepare')).not.toBeInTheDocument();
    expect(screen.queryByText('Answers you already submitted')).not.toBeInTheDocument();
  });

  it('shows an action_not_current message, no stale prep, and a working Reload button when the deterministic action changed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'action_not_current', currentActionType: 'NO_ACTION' }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() => expect(screen.getByText(/status changed/)).toBeInTheDocument());
    expect(screen.queryByText('Role priorities')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload this page' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows an insufficient_context message when there is no job snapshot', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'insufficient_context' }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText(/no saved job posting/)).toBeInTheDocument(),
    );
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'limit' }, 429),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows an error message on provider failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'AI provider error' }, 502),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText('AI provider error')).toBeInTheDocument(),
    );
  });
});

describe('InterviewPrepPanel — Phase 7I research mode selector', () => {
  const LATEST_RESEARCH = { id: 'snapshot-1', researchedAt: '2026-09-15T12:00:00.000Z' };

  it('with no research, shows no mode selector at all — never advertises a missing feature', () => {
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={null} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('with research available, shows the selector defaulting to Job only — never mandatory', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    const jobOnly = screen.getByRole('radio', { name: 'Job only' });
    const withResearch = screen.getByRole('radio', { name: /Job \+ company research/ });
    expect(jobOnly).toBeChecked();
    expect(withResearch).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/interview-prep`,
      expect.objectContaining({ body: JSON.stringify({ researchMode: 'JOB_ONLY' }) }),
    );
  });

  it('selecting Job + company research sends the researchMode and snapshot id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Job \+ company research/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/interview-prep`,
      expect.objectContaining({
        body: JSON.stringify({
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: LATEST_RESEARCH.id,
        }),
      }),
    );
  });

  it('identifies research context human-readably, with no raw research ids shown', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        prep: {
          ...FULL_PREP,
          researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
          companyResearchSnapshotId: 'snapshot-1',
          companyResearchResearchedAt: '2026-09-15T12:00:00.000Z',
          selectedResearchFindingCount: 3,
          questionsToAsk: [
            {
              question: 'How is the analytics platform investment going?',
              rationale: 'Shows interest in a current priority.',
              companyRelevance: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  claim: 'Acme is expanding its analytics platform.',
                  roleRelevance: 'Directly relevant to this role.',
                  category: 'TECHNOLOGY',
                },
              ],
            },
          ],
        },
      }),
    );
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Job \+ company research/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));

    await waitFor(() =>
      expect(screen.getByText(/Based on this job \+ company research from/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Company relevance:')).toBeInTheDocument();
    expect(screen.getByText(/Directly relevant to this role/)).toBeInTheDocument();
    expect(
      screen.queryByText(/11111111-1111-4111-8111-111111111111/),
    ).not.toBeInTheDocument();
  });

  it('shows a stale_company_research message with a link to research again', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'stale_company_research' }),
    );
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText(/no longer matches this application/)).toBeInTheDocument(),
    );
  });

  it('shows a research_snapshot_not_found message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'research_snapshot_not_found' }),
    );
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText(/no longer available/)).toBeInTheDocument(),
    );
  });

  it('never fetches or generates merely from rendering the component', () => {
    render(
      <InterviewPrepPanel applicationId={APPLICATION_ID} latestCompanyResearch={LATEST_RESEARCH} />,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
