// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartApplicationButton } from './start-application-button';

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const JOB_CATALOG_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StartApplicationButton', () => {
  it('shows "Start application" for an untracked job — never "Apply automatically"/"Quick apply"/"Auto apply"', () => {
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId={null}
        trackedApplicationStatus={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start application' })).toBeInTheDocument();
    const text = document.body.textContent?.toLowerCase() ?? '';
    expect(text).not.toMatch(/apply automatically|quick apply|auto apply/);
  });

  it('shows "View application" and the real status badge for a tracked job — never also showing Start application', () => {
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId="app-1"
        trackedApplicationStatus="IN_PROGRESS"
      />,
    );
    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute(
      'href',
      '/applications/app-1',
    );
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start application' })).not.toBeInTheDocument();
  });

  it('clicking Start application calls the handoff endpoint and navigates to the returned application id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(jsonResponse({ applicationId: 'app-2', created: true, status: 'SAVED' })),
    );
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId={null}
        trackedApplicationStatus={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/applications/app-2'));
    expect(fetch).toHaveBeenCalledWith(
      `/api/discovery/${JOB_CATALOG_ID}/start-application`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a pending state while the request is in flight', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId={null}
        trackedApplicationStatus={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Starting application…' })).toBeDisabled(),
    );
    resolveFetch(await jsonResponse({ applicationId: 'app-2', created: true, status: 'SAVED' }));
  });

  it('shows an actionable error and never navigates when the server reports a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(jsonResponse({ error: 'Could not start this application. Please try again.' }, 502)),
    );
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId={null}
        trackedApplicationStatus={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));

    await waitFor(() =>
      expect(
        screen.getByText('Could not start this application. Please try again.'),
      ).toBeInTheDocument(),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows a generic error and never crashes on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(
      <StartApplicationButton
        jobCatalogId={JOB_CATALOG_ID}
        trackedApplicationId={null}
        trackedApplicationStatus={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));

    await waitFor(() =>
      expect(
        screen.getByText(/Could not start this application\. Please check your connection/),
      ).toBeInTheDocument(),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
