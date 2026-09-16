import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incrementOwnAiRequestUsage: vi.fn(),
  decrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForEmailClassification: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  decrementOwnAiRequestUsage: mocks.decrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForEmailClassification: mocks.callClaudeForEmailClassification,
}));

const { classifyEmail } = await import('./generate-email-classification');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

const PARAMS = {
  sender: 'careers@acme.com',
  subject: 'Your interview with Acme',
  snippet: "We'd like to schedule a call to discuss next steps.",
};

function validClassificationJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    classification: 'INTERVIEW',
    confidence: 0.92,
    evidence: "subject contains 'interview'",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrementOwnAiRequestUsage.mockResolvedValue(undefined);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.recordAiUsageEvent.mockResolvedValue({});
});

describe('classifyEmail — rate limit', () => {
  it('short-circuits before any Claude call', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });
    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.callClaudeForEmailClassification).not.toHaveBeenCalled();
  });
});

describe('classifyEmail — success path', () => {
  it('classifies on the first valid attempt', async () => {
    mocks.callClaudeForEmailClassification.mockResolvedValueOnce({
      status: 'ok',
      rawText: validClassificationJson(),
    });

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({
      status: 'classified',
      classification: 'INTERVIEW',
      confidence: 0.92,
      evidence: "subject contains 'interview'",
    });
    expect(mocks.callClaudeForEmailClassification).toHaveBeenCalledTimes(1);
  });
});

describe('classifyEmail — rejection gate and retry-once', () => {
  it('retries once and classifies when attempt 2 passes validation', async () => {
    mocks.callClaudeForEmailClassification
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validClassificationJson() });

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('classified');
    expect(mocks.callClaudeForEmailClassification).toHaveBeenCalledTimes(2);
  });

  it('retries once on a refusal and succeeds if the retry passes', async () => {
    mocks.callClaudeForEmailClassification
      .mockResolvedValueOnce({ status: 'refusal', category: 'cyber' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validClassificationJson() });

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('classified');
    expect(mocks.callClaudeForEmailClassification).toHaveBeenCalledTimes(2);
  });

  it('returns validation_failed when both attempts fail contract validation', async () => {
    mocks.callClaudeForEmailClassification
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: 'still not json' });

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForEmailClassification).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately with no retry', async () => {
    mocks.callClaudeForEmailClassification.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForEmailClassification).toHaveBeenCalledTimes(1);
  });

  it('refunds the reserved quota unit on a provider_error (real incident regression)', async () => {
    mocks.callClaudeForEmailClassification.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledWith(FAKE_SUPABASE, USER_ID);
  });
});

describe('classifyEmail — usage telemetry', () => {
  it('records an ai_usage_events row with task_type email_classification and never fails the request if telemetry recording throws', async () => {
    mocks.callClaudeForEmailClassification.mockResolvedValueOnce({
      status: 'ok',
      rawText: validClassificationJson(),
    });
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));

    const result = await classifyEmail(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('classified');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ taskType: 'email_classification', fieldClassification: null }),
    );
  });
});
