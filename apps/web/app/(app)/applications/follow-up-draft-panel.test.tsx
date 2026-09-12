// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpDraftPanel } from './follow-up-draft-panel';

const APPLICATION_ID = 'app-1';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FollowUpDraftPanel', () => {
  it('never calls fetch on render — only an explicit click triggers the AI request', () => {
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the follow-up-draft endpoint only after "Draft follow-up" is clicked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        draft: { subject: 'Hi', body: 'Following up.', usedContext: [] },
      }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));

    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/follow-up-draft`,
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByText('Regenerate')).toBeInTheDocument());
  });

  it('shows a loading state while generating', async () => {
    let resolve!: (value: unknown) => void;
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    expect(screen.getByRole('button', { name: 'Drafting…' })).toBeDisabled();
    resolve(
      await jsonResponse({
        status: 'ok',
        draft: { subject: null, body: 'x', usedContext: [] },
      }),
    );
  });

  it('renders the editable draft body and subject on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        draft: {
          subject: 'Checking in',
          body: 'Following up on my application.',
          usedContext: ['APPLICATION_STATUS'],
        },
      }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));

    await waitFor(() =>
      expect(
        screen.getByDisplayValue('Following up on my application.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Checking in')).toBeInTheDocument();
    expect(screen.getByText(/AI-generated draft/)).toBeInTheDocument();
    expect(screen.getByText(/Career OS never sends this for you/)).toBeInTheDocument();
  });

  it('never renders a send button — copy/edit only', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        draft: { subject: null, body: 'x', usedContext: [] },
      }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  });

  it('copies the (possibly edited) body text to the clipboard', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({
        status: 'ok',
        draft: { subject: null, body: 'Original body.', usedContext: [] },
      }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() => screen.getByRole('button', { name: 'Copy' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original body.'),
    );
  });

  it('shows an action_not_current message and no draft when the deterministic action changed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'action_not_current', currentActionType: 'NO_ACTION' }),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() => expect(screen.getByText(/status changed/)).toBeInTheDocument());
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'AI request limit reached' }, 429),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows an error message on provider failure, without breaking the rest of the page', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'AI provider error' }, 502),
    );
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() =>
      expect(screen.getByText('AI provider error')).toBeInTheDocument(),
    );
  });

  it('shows an error message when fetch itself throws (network failure)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    render(<FollowUpDraftPanel applicationId={APPLICATION_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    await waitFor(() =>
      expect(screen.getByText('Drafting failed. Try again.')).toBeInTheDocument(),
    );
  });
});
