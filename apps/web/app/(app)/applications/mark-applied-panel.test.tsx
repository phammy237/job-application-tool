// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkAppliedPanel } from './mark-applied-panel';

const mocks = vi.hoisted(() => ({
  markApplicationApplied: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('./actions', () => ({
  markApplicationApplied: mocks.markApplicationApplied,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const WARNING_FINDING = {
  id: 'w1',
  ruleId: 'GPA_MISMATCH',
  severity: 'WARNING' as const,
  fieldALabel: 'GPA',
  fieldAValue: '3.2',
  fieldBLabel: 'Approved GPA',
  fieldBValue: '3.9',
  description: 'Your GPA answer differs from your approved profile.',
};

const BLOCKING_FINDING = {
  id: 'b1',
  ruleId: 'ELIGIBILITY_SELF_CONTRADICTION',
  severity: 'BLOCKING' as const,
  fieldALabel: 'Authorized?',
  fieldAValue: 'Yes',
  fieldBLabel: 'Need sponsorship?',
  fieldBValue: 'No',
  description: 'Two eligibility answers contradict each other.',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MarkAppliedPanel', () => {
  it('shows the initial "Mark as Applied" button', () => {
    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    expect(screen.getByRole('button', { name: 'Mark as Applied' })).toBeInTheDocument();
  });

  it('a clean application (no findings) submits immediately without a review step', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [] }));
    mocks.markApplicationApplied.mockResolvedValue({
      status: 'ok',
      applicationStatus: 'APPLIED',
    });

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));

    await waitFor(() =>
      expect(mocks.markApplicationApplied).toHaveBeenCalledWith(APPLICATION_ID, []),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it('shows each WARNING finding with an unchecked-by-default acknowledgement control and disables confirm until all are checked', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [WARNING_FINDING] }));

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));

    await screen.findByText(WARNING_FINDING.description);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm — Mark as Applied',
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(checkbox);
    expect(confirmButton).toBeEnabled();
  });

  it('submits the acknowledged warning finding id on confirm', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [WARNING_FINDING] }));
    mocks.markApplicationApplied.mockResolvedValue({
      status: 'ok',
      applicationStatus: 'APPLIED',
    });

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));
    await screen.findByText(WARNING_FINDING.description);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm — Mark as Applied' }));

    await waitFor(() =>
      expect(mocks.markApplicationApplied).toHaveBeenCalledWith(APPLICATION_ID, ['w1']),
    );
  });

  it('shows a BLOCKING finding with no way to acknowledge it, and confirm stays disabled', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [BLOCKING_FINDING] }));

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));

    await screen.findByText(BLOCKING_FINDING.description);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm — Mark as Applied' }),
    ).toBeDisabled();
  });

  it('re-renders exactly what the authoritative server action reports when it rejects, even if the earlier GET looked clean', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [] }));
    mocks.markApplicationApplied.mockResolvedValue({
      status: 'consistency_check_failed',
      reason: 'blocking_findings',
      findings: [BLOCKING_FINDING],
    });

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));

    await screen.findByText(BLOCKING_FINDING.description);
  });

  it('the "Check unsupported claims" affordance never fires automatically — only on explicit click', async () => {
    vi.mocked(fetch).mockReturnValueOnce(jsonResponse({ findings: [WARNING_FINDING] }));

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));
    await screen.findByText(WARNING_FINDING.description);

    // Only the deterministic consistency-check GET has fired so far.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an explicit "Check unsupported claims" click POSTs to the AI endpoint and renders returned findings, without touching acknowledgedFindingIds', async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(jsonResponse({ findings: [WARNING_FINDING] }))
      .mockReturnValueOnce(
        jsonResponse({
          status: 'ok',
          findings: [
            {
              id: 'u1',
              ruleId: 'UNSUPPORTED_CLAIM',
              severity: 'WARNING',
              fieldALabel: 'Describe a project you led',
              fieldAValue: 'I led the Kubernetes migration.',
              fieldBLabel: 'Approved evidence',
              fieldBValue: 'no supporting approved facts found',
              description: 'No approved fact backs this claim.',
            },
          ],
        }),
      );
    mocks.markApplicationApplied.mockResolvedValue({
      status: 'ok',
      applicationStatus: 'APPLIED',
    });

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));
    await screen.findByText(WARNING_FINDING.description);

    fireEvent.click(screen.getByRole('button', { name: 'Check unsupported claims' }));

    await screen.findByText('No approved fact backs this claim.');
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/applications/${APPLICATION_ID}/unsupported-claims-check`,
      { method: 'POST' },
    );

    // Confirming still only sends the deterministic acknowledgement — the AI finding's id was
    // never added to acknowledgedFindingIds, since it is advisory-only.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm — Mark as Applied' }));
    await waitFor(() =>
      expect(mocks.markApplicationApplied).toHaveBeenCalledWith(APPLICATION_ID, ['w1']),
    );
  });

  it('shows an "unavailable" message, never a fabricated finding, when the AI check fails', async () => {
    // A clean deterministic result submits immediately, so use a warning finding to keep the
    // panel open for the AI-check affordance.
    vi.mocked(fetch)
      .mockReturnValueOnce(jsonResponse({ findings: [WARNING_FINDING] }))
      .mockReturnValueOnce(
        jsonResponse({ status: 'unavailable', reason: 'provider_error', findings: [] }),
      );

    render(<MarkAppliedPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Applied' }));
    await screen.findByText(WARNING_FINDING.description);

    fireEvent.click(screen.getByRole('button', { name: 'Check unsupported claims' }));

    await screen.findByText(
      'This check is unavailable right now. You can still submit — it never blocks.',
    );
  });
});
