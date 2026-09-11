// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailConnection } from '@career-os/shared';
import { AUTO_SYNC_THROTTLE_MS, GmailSection, isDueForAutoSync } from './gmail-section';

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

const SYNC_SUMMARY = {
  processed: 3,
  autoApplied: 1,
  needsConfirmation: 0,
  skipped: 0,
  errors: [],
};

function connectionFixture(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: 'conn-1',
    userId: 'user-1',
    provider: 'google',
    emailAddress: 'candidate@example.com',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    status: 'ACTIVE',
    lastSyncedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Isolates just the /api/gmail/sync calls out of a mocked fetch's full call history. */
function syncRequestsIn(mockFetch: ReturnType<typeof vi.fn>) {
  return mockFetch.mock.calls.filter(([url]) => url === '/api/gmail/sync');
}

// isDueForAutoSync is a pure function of (lastSyncedAt, Date.now()) — fake timers make the
// throttle boundary deterministic instead of racing the real clock during test execution.
describe('isDueForAutoSync', () => {
  const NOW = new Date('2026-01-01T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is due when there is no previous sync (lastSyncedAt is null)', () => {
    expect(isDueForAutoSync(null)).toBe(true);
  });

  it('is not due when the previous sync is inside the throttle window', () => {
    const insideWindow = new Date(NOW - (AUTO_SYNC_THROTTLE_MS - 1)).toISOString();
    expect(isDueForAutoSync(insideWindow)).toBe(false);
  });

  it('is due once the previous sync is just outside the throttle window', () => {
    const outsideWindow = new Date(NOW - (AUTO_SYNC_THROTTLE_MS + 1)).toISOString();
    expect(isDueForAutoSync(outsideWindow)).toBe(true);
  });

  it('is not due exactly at the throttle boundary — the check is a strict ">", not ">="', () => {
    const exactlyAtBoundary = new Date(NOW - AUTO_SYNC_THROTTLE_MS).toISOString();
    expect(isDueForAutoSync(exactlyAtBoundary)).toBe(false);
  });

  it('fails safe (treats as not due) on a malformed timestamp rather than throwing', () => {
    expect(() => isDueForAutoSync('not-a-real-timestamp')).not.toThrow();
    expect(isDueForAutoSync('not-a-real-timestamp')).toBe(false);
  });
});

describe('GmailSection auto-sync-on-page-load', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(jsonResponse(SYNC_SUMMARY)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fires exactly one auto-sync request on mount when no sync has ever run, even under Strict Mode double-invoked effects', async () => {
    render(
      <StrictMode>
        <GmailSection
          connection={connectionFixture({ lastSyncedAt: null })}
          pendingSignals={[]}
          applications={[]}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(1));
    // Give a second, wrongly-fired effect a chance to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(1);
  });

  it('fires exactly one auto-sync request when the last sync is outside the throttle window, under Strict Mode', async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    render(
      <StrictMode>
        <GmailSection
          connection={connectionFixture({ lastSyncedAt: sixMinutesAgo })}
          pendingSignals={[]}
          applications={[]}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(1);
  });

  it('does not auto-sync when the last sync is inside the throttle window, and the manual button stays available', async () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    render(
      <GmailSection
        connection={connectionFixture({ lastSyncedAt: oneMinuteAgo })}
        pendingSignals={[]}
        applications={[]}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Sync Gmail' })).toBeEnabled();
  });

  it('leaves the manual "Sync Gmail" button clickable after an auto-sync completes', async () => {
    render(
      <GmailSection
        connection={connectionFixture({ lastSyncedAt: null })}
        pendingSignals={[]}
        applications={[]}
      />,
    );

    await waitFor(() => expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync Gmail' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Sync Gmail' }));

    await waitFor(() => expect(syncRequestsIn(vi.mocked(fetch))).toHaveLength(2));
  });
});
