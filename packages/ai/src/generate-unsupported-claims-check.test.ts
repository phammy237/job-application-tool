import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incrementOwnAiRequestUsage: vi.fn(),
  decrementOwnAiRequestUsage: vi.fn(),
  listOwnGeneratedAnswersForApplication: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForUnsupportedClaimCheck: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  decrementOwnAiRequestUsage: mocks.decrementOwnAiRequestUsage,
  listOwnGeneratedAnswersForApplication: mocks.listOwnGeneratedAnswersForApplication,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForUnsupportedClaimCheck: mocks.callClaudeForUnsupportedClaimCheck,
}));

const { generateUnsupportedClaimsCheck } =
  await import('./generate-unsupported-claims-check');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const ANSWER_ID = '55555555-5555-4555-8555-555555555555';
const FACT_ID = '11111111-1111-4111-8111-111111111111';

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

const GENERATED_ANSWER = {
  id: ANSWER_ID,
  userId: USER_ID,
  applicationId: APPLICATION_ID,
  jobId: 'job-1',
  fieldLabel: 'Describe a project you led',
  fieldClassification: 'FREE_RESPONSE' as const,
  answer: 'I led the migration to Kubernetes.',
  confidence: 0.9,
  sourceFactIds: [FACT_ID],
  reasoningSummary: null,
  unsupportedClaims: [],
  requiresUserReview: true,
  userDecision: 'APPROVED' as const,
  finalText: null,
  insufficientData: false,
  rejectionReason: null,
  availableFactIds: null,
  generationRunId: null,
  attemptNumber: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const APPROVED_FACT = {
  id: FACT_ID,
  sourceTable: 'experiences' as const,
  category: 'EXPERIENCE',
  text: 'Led the Kubernetes migration at Acme.',
  tags: [],
  recencyDate: '2025-01-01',
  isOngoing: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function entriesJson(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify(entries);
}

const PARAMS = { applicationId: APPLICATION_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrementOwnAiRequestUsage.mockResolvedValue(undefined);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([GENERATED_ANSWER]);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([APPROVED_FACT]);
  mocks.recordAiUsageEvent.mockResolvedValue({});
});

describe('generateUnsupportedClaimsCheck — rate limit', () => {
  it('short-circuits before any retrieval or Claude call', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({
      ...ALLOWED_USAGE,
      allowed: false,
    });
    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.listOwnGeneratedAnswersForApplication).not.toHaveBeenCalled();
    expect(mocks.callClaudeForUnsupportedClaimCheck).not.toHaveBeenCalled();
  });
});

describe('generateUnsupportedClaimsCheck — retrieval', () => {
  it('returns no_answers_to_check when there are no APPROVED/EDITED answers, without calling Claude', async () => {
    mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([
      { ...GENERATED_ANSWER, userDecision: 'SKIPPED' },
    ]);
    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'no_answers_to_check' });
    expect(mocks.callClaudeForUnsupportedClaimCheck).not.toHaveBeenCalled();
  });

  it('returns insufficient_facts without calling Claude when no approved facts exist', async () => {
    mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([]);
    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'insufficient_facts' });
    expect(mocks.callClaudeForUnsupportedClaimCheck).not.toHaveBeenCalled();
  });
});

describe('generateUnsupportedClaimsCheck — success path', () => {
  it('produces a WARNING finding only for an UNSUPPORTED entry', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        {
          supportStatus: 'UNSUPPORTED',
          citedFactIds: [],
          explanation: 'No fact backs this up.',
        },
      ]),
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        ruleId: 'UNSUPPORTED_CLAIM',
        severity: 'WARNING',
        fieldALabel: GENERATED_ANSWER.fieldLabel,
      });
    }
  });

  it('produces no findings for a SUPPORTED entry', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        {
          supportStatus: 'SUPPORTED',
          citedFactIds: [FACT_ID],
          explanation: 'Matches the fact.',
        },
      ]),
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'ok', findings: [] });
  });

  it('produces no findings for an UNCERTAIN entry — never guesses either way', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        { supportStatus: 'UNCERTAIN', citedFactIds: [], explanation: 'Unclear.' },
      ]),
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'ok', findings: [] });
  });

  it('a produced finding is always WARNING, never BLOCKING, regardless of model output', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        {
          supportStatus: 'UNSUPPORTED',
          citedFactIds: [],
          explanation: 'Unsupported claim.',
        },
      ]),
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.findings.every((f) => f.severity === 'WARNING')).toBe(true);
    }
  });
});

describe('generateUnsupportedClaimsCheck — contract validation and retry-once', () => {
  it('rejects and retries once when the citedFactIds includes an id outside the allowed fact list, and succeeds if the retry passes', async () => {
    mocks.callClaudeForUnsupportedClaimCheck
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: entriesJson([
          {
            supportStatus: 'SUPPORTED',
            citedFactIds: ['99999999-9999-4999-8999-999999999999'],
            explanation: 'x',
          },
        ]),
      })
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: entriesJson([
          { supportStatus: 'SUPPORTED', citedFactIds: [FACT_ID], explanation: 'x' },
        ]),
      });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'ok', findings: [] });
    expect(mocks.callClaudeForUnsupportedClaimCheck).toHaveBeenCalledTimes(2);
  });

  it('rejects when the response array length does not match the number of answers sent, even if otherwise well-formed', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValue({
      status: 'ok',
      rawText: entriesJson([]), // zero entries for one answer
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForUnsupportedClaimCheck).toHaveBeenCalledTimes(2);
  });

  it('returns validation_failed after both attempts fail, never fabricating a finding', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValue({
      status: 'ok',
      rawText: 'not json',
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForUnsupportedClaimCheck).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately with no retry', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForUnsupportedClaimCheck).toHaveBeenCalledTimes(1);
  });

  it('refunds the reserved quota unit on a provider_error (real incident regression)', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });
    await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledWith(FAKE_SUPABASE, USER_ID);
  });

  it('retries once on a refusal and succeeds if the retry passes', async () => {
    mocks.callClaudeForUnsupportedClaimCheck
      .mockResolvedValueOnce({ status: 'refusal', category: 'cyber' })
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: entriesJson([
          { supportStatus: 'SUPPORTED', citedFactIds: [FACT_ID], explanation: 'x' },
        ]),
      });

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'ok', findings: [] });
    expect(mocks.callClaudeForUnsupportedClaimCheck).toHaveBeenCalledTimes(2);
  });
});

describe('generateUnsupportedClaimsCheck — usage telemetry', () => {
  it('records an ai_usage_events row with task_type unsupported_claim_check and never fails the request if telemetry recording throws', async () => {
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        { supportStatus: 'SUPPORTED', citedFactIds: [FACT_ID], explanation: 'x' },
      ]),
    });
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));

    const result = await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({
        taskType: 'unsupported_claim_check',
        fieldClassification: null,
      }),
    );
  });

  it('only considers APPROVED/EDITED answers — a SKIPPED suggestion is never sent to Claude', async () => {
    mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([
      GENERATED_ANSWER,
      { ...GENERATED_ANSWER, id: 'other-id', userDecision: 'SKIPPED' },
    ]);
    mocks.callClaudeForUnsupportedClaimCheck.mockResolvedValueOnce({
      status: 'ok',
      rawText: entriesJson([
        { supportStatus: 'SUPPORTED', citedFactIds: [FACT_ID], explanation: 'x' },
      ]),
    });

    await generateUnsupportedClaimsCheck(FAKE_SUPABASE, USER_ID, PARAMS);

    const [, userText] = mocks.callClaudeForUnsupportedClaimCheck.mock.calls[0] as [
      string,
      string,
    ];
    expect(userText).not.toContain('other-id');
  });
});
