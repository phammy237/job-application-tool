import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnApplication: vi.fn(),
  listOwnRelevantStatusChangeEventsForApplication: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  getOwnProfile: vi.fn(),
  listOwnEmailSignalsForApplication: vi.fn(),
  incrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForFollowUpDraft: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  listOwnRelevantStatusChangeEventsForApplication:
    mocks.listOwnRelevantStatusChangeEventsForApplication,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  getOwnProfile: mocks.getOwnProfile,
  listOwnEmailSignalsForApplication: mocks.listOwnEmailSignalsForApplication,
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForFollowUpDraft: mocks.callClaudeForFollowUpDraft,
}));

const { generateFollowUpDraft } = await import('./generate-follow-up-draft');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const PARAMS = { applicationId: APPLICATION_ID };

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    userId: USER_ID,
    jobId: null,
    resumeId: null,
    company: 'Acme',
    title: 'Engineer',
    status: 'APPLIED',
    notes: null,
    appliedAt: daysAgo(10),
    location: null,
    sourceUrl: null,
    canonicalUrl: null,
    atsProvider: null,
    externalId: null,
    autofillSummary: null,
    unresolvedFields: null,
    jobSnapshotId: null,
    submissionPacketId: null,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    ...overrides,
  };
}

function draftJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    subject: 'Checking in on my application',
    body: 'Hello, I wanted to follow up on my application for the Engineer role. Best regards,',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnApplication.mockResolvedValue(application());
  mocks.listOwnRelevantStatusChangeEventsForApplication.mockResolvedValue([]);
  mocks.getOwnJobSnapshot.mockResolvedValue(null);
  mocks.getOwnProfile.mockResolvedValue(null);
  mocks.listOwnEmailSignalsForApplication.mockResolvedValue([]);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.recordAiUsageEvent.mockResolvedValue({});
  mocks.callClaudeForFollowUpDraft.mockResolvedValue({
    status: 'ok',
    rawText: draftJson(),
  });
});

describe('generateFollowUpDraft — eligibility gate', () => {
  it('returns application_not_found without checking rate limit or calling Claude when the application does not exist or is not owned', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'application_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForFollowUpDraft).not.toHaveBeenCalled();
  });

  it('returns action_not_current, without consuming rate limit, when the current status is not eligible (e.g. REJECTED)', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ status: 'REJECTED' }));
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForFollowUpDraft).not.toHaveBeenCalled();
  });

  it('returns action_not_current when the application was applied too recently to be below the follow-up threshold yet', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ appliedAt: daysAgo(1) }));
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('a confirmed later status-change event resets the anchor, which can also make follow-up no longer current', async () => {
    mocks.getOwnApplication.mockResolvedValue(
      application({ status: 'APPLICATION_RECEIVED', appliedAt: daysAgo(10) }),
    );
    mocks.listOwnRelevantStatusChangeEventsForApplication.mockResolvedValue([
      {
        id: 'evt-1',
        userId: USER_ID,
        applicationId: APPLICATION_ID,
        eventType: 'STATUS_CHANGE',
        fromStatus: 'APPLIED',
        toStatus: 'APPLICATION_RECEIVED',
        source: 'GMAIL_SYNC',
        emailSignalId: null,
        revertedAt: null,
        createdAt: daysAgo(1),
      },
    ]);
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
  });
});

describe('generateFollowUpDraft — rate limit', () => {
  it('returns rate_limited without calling Claude when the eligible request is blocked', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({
      ...ALLOWED_USAGE,
      allowed: false,
    });
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.callClaudeForFollowUpDraft).not.toHaveBeenCalled();
  });
});

describe('generateFollowUpDraft — success path', () => {
  it('returns the validated draft with server-computed usedContext tags', async () => {
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.draft.body).toContain('follow up');
      expect(result.draft.usedContext).toContain('APPLICATION_STATUS');
      expect(result.draft.usedContext).toContain('APPLICATION_DATE');
      expect(result.draft.usedContext).toContain('FOLLOW_UP_TIMING');
      // Nothing was retrieved for these — usedContext must never claim otherwise.
      expect(result.draft.usedContext).not.toContain('JOB_SNAPSHOT');
      expect(result.draft.usedContext).not.toContain('CONFIRMED_EMPLOYER_EMAIL');
      expect(result.draft.usedContext).not.toContain('CANDIDATE_NAME');
    }
  });

  it('includes JOB_SNAPSHOT/CONFIRMED_EMPLOYER_EMAIL/CANDIDATE_NAME only when those were actually retrieved', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue({
      id: 'snap-1',
      title: 'Engineer',
      company: 'Acme',
    });
    mocks.getOwnProfile.mockResolvedValue({ fullName: 'Jane Doe' });
    mocks.listOwnEmailSignalsForApplication.mockResolvedValue([
      {
        sender: 'careers@acme.com',
        subject: 'Thanks for applying',
        classification: 'APPLICATION_RECEIVED',
        receivedAt: daysAgo(9),
        confirmationStatus: 'CONFIRMED',
      },
    ]);
    mocks.getOwnApplication.mockResolvedValue(application({ jobSnapshotId: 'snap-1' }));

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.draft.usedContext).toEqual(
        expect.arrayContaining([
          'JOB_SNAPSHOT',
          'CONFIRMED_EMPLOYER_EMAIL',
          'CANDIDATE_NAME',
        ]),
      );
    }
  });

  it('never includes a PENDING or DECLINED email signal as confirmed context', async () => {
    mocks.listOwnEmailSignalsForApplication.mockResolvedValue([
      {
        sender: 'someone@acme.com',
        subject: 'x',
        classification: 'OTHER',
        confirmationStatus: 'PENDING',
      },
    ]);
    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.draft.usedContext).not.toContain('CONFIRMED_EMPLOYER_EMAIL');
    }
    const [, userText] = mocks.callClaudeForFollowUpDraft.mock.calls[0] as [
      string,
      string,
    ];
    expect(userText).not.toContain('confirmed_employer_email');
  });
});

describe('generateFollowUpDraft — fabricated-interaction rejection and retry', () => {
  it('rejects a draft claiming a prior conversation and retries once, succeeding if the retry is clean', async () => {
    mocks.callClaudeForFollowUpDraft
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: draftJson({ body: 'I enjoyed speaking with your recruiter last week.' }),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: draftJson() });

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForFollowUpDraft).toHaveBeenCalledTimes(2);
  });

  it('returns validation_failed after both attempts still fabricate an interaction, never returning the fabricated draft', async () => {
    mocks.callClaudeForFollowUpDraft.mockResolvedValue({
      status: 'ok',
      rawText: draftJson({ body: 'Following up after our interview last week.' }),
    });

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForFollowUpDraft).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed JSON and retries once', async () => {
    mocks.callClaudeForFollowUpDraft
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: draftJson() });

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForFollowUpDraft).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately with no retry', async () => {
    mocks.callClaudeForFollowUpDraft.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForFollowUpDraft).toHaveBeenCalledTimes(1);
  });

  it('retries once on a refusal', async () => {
    mocks.callClaudeForFollowUpDraft
      .mockResolvedValueOnce({ status: 'refusal', category: 'cyber' })
      .mockResolvedValueOnce({ status: 'ok', rawText: draftJson() });

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForFollowUpDraft).toHaveBeenCalledTimes(2);
  });
});

describe('generateFollowUpDraft — usage telemetry and routing', () => {
  it('records an ai_usage_events row with task_type follow_up_draft and provider/model, and never fails the request if telemetry throws', async () => {
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));

    const result = await generateFollowUpDraft(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({
        taskType: 'follow_up_draft',
        provider: 'anthropic',
        applicationId: APPLICATION_ID,
      }),
    );
  });
});
