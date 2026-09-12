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
    },
  ],
  evidenceToEmphasize: [
    { theme: 'Kubernetes', sourceFactIds: [], summary: 'Led a migration.' },
  ],
  starStoryPrompts: [
    {
      competency: 'Leadership',
      sourceFactIds: [],
      prompt: 'Describe leading the migration.',
    },
  ],
  possibleQuestions: [
    {
      question: 'How do you approach scaling?',
      rationale: 'Role emphasizes scale.',
      sourceRequirementIds: [],
    },
  ],
  questionsToAsk: [
    {
      question: 'What does success look like in 6 months?',
      rationale: 'Shows initiative.',
    },
  ],
  gapsToPrepare: [
    {
      requirement: 'AWS certification',
      sourceRequirementId: null,
      note: 'No approved fact covers this.',
    },
  ],
  submittedAnswersToReview: [{ fieldLabel: 'Why us?', answerText: 'Because I love it.' }],
  provenanceSummary: 'Based on 6 job requirements and 8 approved profile facts.',
  usedCurrentRequirementMapping: true,
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
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the interview-prep endpoint only after "Generate interview prep" is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));

    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/interview-prep`,
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());
  });

  it('shows a loading state while generating', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  });

  it('renders every structured section and the provenance summary on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', prep: FULL_PREP }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
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
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() => expect(screen.getByText('Role priorities')).toBeInTheDocument());
    expect(screen.queryByText('Gaps to prepare')).not.toBeInTheDocument();
    expect(screen.queryByText('Answers you already submitted')).not.toBeInTheDocument();
  });

  it('shows an action_not_current message, no stale prep, and a working Reload button when the deterministic action changed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'action_not_current', currentActionType: 'NO_ACTION' }),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
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
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText(/no saved job posting/)).toBeInTheDocument(),
    );
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'limit' }, 429),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows an error message on provider failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'AI provider error' }, 502),
    );
    render(<InterviewPrepPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate interview prep' }));
    await waitFor(() =>
      expect(screen.getByText('AI provider error')).toBeInTheDocument(),
    );
  });
});
