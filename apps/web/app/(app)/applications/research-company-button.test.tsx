// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { ResearchCompanyButton } = await import('./research-company-button');

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
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResearchCompanyButton', () => {
  it('never calls fetch on render', () => {
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Research company" />,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs exactly once and refreshes the router on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'ok', snapshot: {} }),
    );
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Research company" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Research company' }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/company-research`,
      { method: 'POST' },
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('shows a friendly message and does not refresh on no_useful_sources', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'no_useful_sources' }),
    );
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Research company" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Research company' }));
    await waitFor(() =>
      expect(
        screen.getByText('No useful public sources were found for this company.'),
      ).toBeInTheDocument(),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('shows a rate-limit message on 429', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ error: 'limit' }, 429),
    );
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Research company" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Research company' }));
    await waitFor(() => expect(screen.getByText(/AI request limit/)).toBeInTheDocument());
  });

  it('shows a stale-context message and never claims success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ status: 'stale_application_context' }),
    );
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Refresh research" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh research' }));
    await waitFor(() =>
      expect(screen.getByText(/changed while research was running/)).toBeInTheDocument(),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('disables the button while a request is in flight', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(
      <ResearchCompanyButton applicationId={APPLICATION_ID} label="Research company" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Research company' }));
    expect(screen.getByRole('button', { name: 'Researching…' })).toBeDisabled();
  });
});
