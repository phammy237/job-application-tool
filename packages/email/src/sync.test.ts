import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';

const mocks = vi.hoisted(() => ({
  getOwnEmailConnectionWithToken: vi.fn(),
  decryptRefreshToken: vi.fn(),
  listOwnApplications: vi.fn(),
  listOwnEmailSignals: vi.fn(),
  listOwnProcessedMessageIds: vi.fn(),
  updateOwnEmailConnectionAfterSync: vi.fn(),
  createOwnEmailSignal: vi.fn(),
  changeOwnApplicationStatus: vi.fn(),
  createAutoTrackedApplicationFromEmail: vi.fn(),
  classifyEmail: vi.fn(),
  refreshAccessToken: vi.fn(),
  searchMessages: vi.fn(),
  getMessageMetadata: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnEmailConnectionWithToken: mocks.getOwnEmailConnectionWithToken,
  decryptRefreshToken: mocks.decryptRefreshToken,
  listOwnApplications: mocks.listOwnApplications,
  listOwnEmailSignals: mocks.listOwnEmailSignals,
  listOwnProcessedMessageIds: mocks.listOwnProcessedMessageIds,
  updateOwnEmailConnectionAfterSync: mocks.updateOwnEmailConnectionAfterSync,
  createOwnEmailSignal: mocks.createOwnEmailSignal,
  changeOwnApplicationStatus: mocks.changeOwnApplicationStatus,
  createAutoTrackedApplicationFromEmail: mocks.createAutoTrackedApplicationFromEmail,
}));

vi.mock('@career-os/ai', () => ({
  classifyEmail: mocks.classifyEmail,
}));

vi.mock('./oauth', () => ({
  refreshAccessToken: mocks.refreshAccessToken,
}));

vi.mock('./gmail-client', () => ({
  searchMessages: mocks.searchMessages,
  getMessageMetadata: mocks.getMessageMetadata,
}));

const { runGmailSync } = await import('./sync');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;

const CONNECTION = {
  id: 'conn-1',
  encryptedRefreshToken: 'encrypted',
  emailAddress: 'user@example.com',
};

function messageMetadata(overrides: Partial<Awaited<ReturnType<typeof mocks.getMessageMetadata>>> = {}) {
  return {
    id: 'msg-1',
    sender: 'Acme Careers <careers@acme.com>',
    senderDomain: 'acme.com',
    subject: 'Your application for Backend Engineer',
    snippet: 'Thank you for applying — we have received your application.',
    receivedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnEmailConnectionWithToken.mockResolvedValue(CONNECTION);
  mocks.decryptRefreshToken.mockReturnValue('refresh-token');
  mocks.refreshAccessToken.mockResolvedValue('access-token');
  mocks.listOwnApplications.mockResolvedValue([]);
  mocks.listOwnEmailSignals.mockResolvedValue([]);
  mocks.listOwnProcessedMessageIds.mockResolvedValue(new Set());
  mocks.searchMessages.mockResolvedValue([{ id: 'msg-1' }]);
  mocks.getMessageMetadata.mockResolvedValue(messageMetadata());
  mocks.createOwnEmailSignal.mockResolvedValue({ id: 'signal-1' });
  mocks.createAutoTrackedApplicationFromEmail.mockResolvedValue({ id: 'new-app-1' });
  mocks.updateOwnEmailConnectionAfterSync.mockResolvedValue(undefined);
});

describe('runGmailSync — auto-create (allowAutoCreate: true)', () => {
  it('creates a new application from a confident, unmatched "application received" message', async () => {
    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ status: 'synced', autoCreated: 1, autoApplied: 0 });
    expect(mocks.createAutoTrackedApplicationFromEmail).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({
        company: 'Acme',
        title: 'Backend Engineer',
        appliedAt: '2026-02-01T00:00:00.000Z',
        emailSignalId: 'signal-1',
      }),
    );
    expect(mocks.createOwnEmailSignal).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ confirmationStatus: 'AUTO_CREATED', matchedApplicationId: null }),
    );
  });

  it('does not create an application when allowAutoCreate is false (manual sync route behavior, unchanged)', async () => {
    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: false,
    });

    expect(result).toMatchObject({ autoCreated: 0 });
    expect(mocks.createAutoTrackedApplicationFromEmail).not.toHaveBeenCalled();
  });

  it('does not create an application when allowAutoCreate is omitted entirely (defaults to off)', async () => {
    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE);
    expect(result).toMatchObject({ autoCreated: 0 });
    expect(mocks.createAutoTrackedApplicationFromEmail).not.toHaveBeenCalled();
  });

  it('does not create an application when the message already matches an existing tracked application', async () => {
    mocks.listOwnApplications.mockResolvedValue([
      { id: 'existing-app', company: 'Acme', title: 'Backend Engineer' },
    ]);

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ autoCreated: 0 });
    expect(mocks.createAutoTrackedApplicationFromEmail).not.toHaveBeenCalled();
  });

  it('does not create an application for a classification other than APPLICATION_RECEIVED, even unmatched and confident', async () => {
    mocks.getMessageMetadata.mockResolvedValue(
      messageMetadata({
        subject: 'Your interview with Acme',
        snippet: 'We would like to schedule an interview with you.',
      }),
    );

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ autoCreated: 0 });
    expect(mocks.createAutoTrackedApplicationFromEmail).not.toHaveBeenCalled();
  });

  it('does not create an application when no company name can be confidently extracted', async () => {
    mocks.getMessageMetadata.mockResolvedValue(
      messageMetadata({ sender: 'careers@acme.com' }), // bare address, no display name
    );

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ autoCreated: 0, skipped: 1 });
    expect(mocks.createAutoTrackedApplicationFromEmail).not.toHaveBeenCalled();
  });

  it('falls back to the undetected-title placeholder, still creating the application, when only the title is unclear', async () => {
    mocks.getMessageMetadata.mockResolvedValue(
      messageMetadata({ subject: 'Thanks for reaching out, we have received your application!' }),
    );

    await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, { allowAutoCreate: true });

    expect(mocks.createAutoTrackedApplicationFromEmail).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ title: 'Role not detected — edit this' }),
    );
  });
});

describe('runGmailSync — duplicate-creation prevention within one batch (the real bug caught while optimizing message fetching)', () => {
  it('creates at most one application for two unmatched messages that are both confident "application received" confirmations for the same company in the same sync run', async () => {
    mocks.searchMessages.mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }]);
    mocks.getMessageMetadata.mockImplementation(async (_accessToken: string, messageId: string) =>
      messageMetadata({ id: messageId }),
    );
    mocks.createAutoTrackedApplicationFromEmail.mockResolvedValue({
      id: 'new-app-1',
      company: 'Acme',
      title: 'Backend Engineer',
      status: 'APPLIED',
    });

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ autoCreated: 1 });
    expect(mocks.createAutoTrackedApplicationFromEmail).toHaveBeenCalledTimes(1);
  });
});

describe('runGmailSync — parallel metadata fetch', () => {
  it("processes every message even when one message's metadata fetch fails, recording that one as an error without blocking the rest", async () => {
    mocks.searchMessages.mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }]);
    mocks.getMessageMetadata.mockImplementation(async (_accessToken: string, messageId: string) => {
      if (messageId === 'msg-1') throw new Error('Gmail messages.get failed: 500');
      return messageMetadata({ id: messageId });
    });

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ status: 'synced', processed: 1 });
    if (result.status === 'synced') {
      expect(result.errors).toEqual([
        { messageId: 'msg-1', message: 'Gmail messages.get failed: 500' },
      ]);
    }
  });
});

describe('runGmailSync — existing match/update behavior (regression, unaffected by auto-create)', () => {
  it('auto-applies a status update on a confident, unambiguous match to an existing application', async () => {
    mocks.listOwnApplications.mockResolvedValue([
      { id: 'existing-app', company: 'Acme', title: 'Backend Engineer' },
    ]);

    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE, {
      allowAutoCreate: true,
    });

    expect(result).toMatchObject({ autoApplied: 1, autoCreated: 0 });
    expect(mocks.changeOwnApplicationStatus).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      'existing-app',
      'APPLICATION_RECEIVED',
      expect.objectContaining({ source: 'GMAIL_SYNC' }),
    );
  });

  it('returns no_connection when the user has no Gmail connection', async () => {
    mocks.getOwnEmailConnectionWithToken.mockResolvedValue(null);
    const result = await runGmailSync(FAKE_SUPABASE, USER_ID, FAKE_SUPABASE);
    expect(result).toEqual({ status: 'no_connection' });
  });
});
