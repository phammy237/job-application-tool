import type { CareerOsSupabaseClient } from '@career-os/database';
import { fieldClassificationSchema, type FieldClassification, type Job } from '@career-os/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incrementOwnAiRequestUsage: vi.fn(),
  decrementOwnAiRequestUsage: vi.fn(),
  getOwnJob: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  createOwnGeneratedAnswer: vi.fn(),
  callClaudeForSuggestion: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  decrementOwnAiRequestUsage: mocks.decrementOwnAiRequestUsage,
  getOwnJob: mocks.getOwnJob,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  createOwnGeneratedAnswer: mocks.createOwnGeneratedAnswer,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForSuggestion: mocks.callClaudeForSuggestion,
}));

const { generateSuggestion } = await import('./generate-suggestion');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

const JOB: Job = {
  id: 'job-1',
  userId: USER_ID,
  company: 'Acme',
  title: 'Backend Engineer',
  location: null,
  employmentType: null,
  description: 'Build the payments service using TypeScript and Postgres.',
  responsibilities: [],
  qualifications: [],
  preferredQualifications: [],
  skills: ['TypeScript', 'Postgres'],
  sourceUrl: null,
  platformType: null,
  rawExtraction: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RELEVANT_FACT = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceTable: 'experiences' as const,
  category: 'EXPERIENCE',
  text: 'Built the payments service using TypeScript and Postgres.',
  tags: ['typescript', 'postgres'],
  recencyDate: '2025-01-01',
  isOngoing: true,
};

function validContractJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    answer: 'Built the payments service handling 2M requests/day.',
    confidence: 0.8,
    sourceFactIds: [RELEVANT_FACT.id],
    reasoningSummary: 'Based on your Acme Corp backend role.',
    unsupportedClaims: [],
    requiresUserReview: true,
    insufficientData: false,
    ...overrides,
  });
}

const BASE_PARAMS = {
  jobId: 'job-1',
  applicationId: null,
  fieldLabel: 'Describe a relevant project.',
  fieldClassification: 'EXPERIENCE' as FieldClassification,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrementOwnAiRequestUsage.mockResolvedValue(undefined);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.getOwnJob.mockResolvedValue(JOB);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([RELEVANT_FACT]);
  mocks.createOwnGeneratedAnswer.mockImplementation(async (_supabase, _userId, input) => ({
    id: 'generated-1',
    userId: USER_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  }));
});

describe('generateSuggestion — structural refusal (CLAUDE.md enforcement, not labeling)', () => {
  it.each(['DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION'] as const)(
    'refuses %s without touching the rate limit, DB, or Claude',
    async (fieldClassification) => {
      const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, {
        ...BASE_PARAMS,
        fieldClassification,
      });
      expect(result).toEqual({ status: 'not_supported_for_field' });
      expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
      expect(mocks.callClaudeForSuggestion).not.toHaveBeenCalled();
    },
  );

  it('refuses exactly the three protected classifications, and only those, across the full enum', async () => {
    // Rate-limit-block every call so the non-protected branch short-circuits right after the
    // structural-refusal check — this test is only about that gate, not full generation.
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });

    for (const classification of fieldClassificationSchema.options) {
      mocks.incrementOwnAiRequestUsage.mockClear();
      const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, {
        ...BASE_PARAMS,
        fieldClassification: classification,
      });
      const isProtected = ['DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION'].includes(classification);
      if (isProtected) {
        expect(result).toEqual({ status: 'not_supported_for_field' });
        expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
      } else {
        expect(result).toEqual({
          status: 'rate_limited',
          usage: { ...ALLOWED_USAGE, allowed: false },
        });
        expect(mocks.incrementOwnAiRequestUsage).toHaveBeenCalledTimes(1);
      }
    }
  });
});

describe('generateSuggestion — rate limit', () => {
  it('short-circuits before retrieval or any Claude call when the limit is reached', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });
    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.getOwnJob).not.toHaveBeenCalled();
    expect(mocks.listOwnApprovedFactsForGeneration).not.toHaveBeenCalled();
    expect(mocks.callClaudeForSuggestion).not.toHaveBeenCalled();
  });
});

describe('generateSuggestion — job lookup', () => {
  it('returns job_not_found when the job does not exist or is not owned by the caller', async () => {
    mocks.getOwnJob.mockResolvedValue(null);
    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);
    expect(result).toEqual({ status: 'job_not_found' });
    expect(mocks.callClaudeForSuggestion).not.toHaveBeenCalled();
  });
});

describe('generateSuggestion — insufficient facts (honest cannot-answer, no Claude call)', () => {
  it('returns insufficient_facts without calling Claude when no approved facts exist', async () => {
    mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([]);
    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);
    expect(result).toEqual({ status: 'insufficient_facts' });
    expect(mocks.callClaudeForSuggestion).not.toHaveBeenCalled();
  });
});

describe('generateSuggestion — rejection gate and retry-once', () => {
  it('retries once and persists+returns generated when attempt 2 passes both checks', async () => {
    mocks.callClaudeForSuggestion
      .mockResolvedValueOnce({ status: 'ok', rawText: validContractJson({ unsupportedClaims: ['x'] }) })
      .mockResolvedValueOnce({ status: 'ok', rawText: validContractJson() });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result.status).toBe('generated');
    expect(mocks.callClaudeForSuggestion).toHaveBeenCalledTimes(2);
    expect(mocks.createOwnGeneratedAnswer).toHaveBeenCalledTimes(1);
  });

  it('returns no_suggestion and persists nothing when both attempts fail schema validation', async () => {
    mocks.callClaudeForSuggestion
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: 'still not json' });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result).toEqual({ status: 'no_suggestion' });
    expect(mocks.callClaudeForSuggestion).toHaveBeenCalledTimes(2);
    expect(mocks.createOwnGeneratedAnswer).not.toHaveBeenCalled();
  });

  it('persists the rejected-but-structurally-valid answer for audit when both attempts have unsupported claims, but still returns no_suggestion', async () => {
    const rejectedJson = validContractJson({ unsupportedClaims: ['unverifiable claim'] });
    mocks.callClaudeForSuggestion
      .mockResolvedValueOnce({ status: 'ok', rawText: rejectedJson })
      .mockResolvedValueOnce({ status: 'ok', rawText: rejectedJson });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result).toEqual({ status: 'no_suggestion' });
    expect(mocks.createOwnGeneratedAnswer).toHaveBeenCalledTimes(1);
    const [, , persistedInput] = mocks.createOwnGeneratedAnswer.mock.calls[0] as [
      unknown,
      unknown,
      { unsupportedClaims: string[] },
    ];
    expect(persistedInput.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('retries once on a refusal and succeeds if the retry passes', async () => {
    mocks.callClaudeForSuggestion
      .mockResolvedValueOnce({ status: 'refusal', category: 'cyber' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validContractJson() });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result.status).toBe('generated');
    expect(mocks.callClaudeForSuggestion).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately, with no retry, on a hard provider failure', async () => {
    mocks.callClaudeForSuggestion.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForSuggestion).toHaveBeenCalledTimes(1);
    expect(mocks.createOwnGeneratedAnswer).not.toHaveBeenCalled();
  });

  it('refunds the reserved quota unit on a provider_error (real incident regression)', async () => {
    mocks.callClaudeForSuggestion.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledWith(FAKE_SUPABASE, USER_ID);
  });

  it('never refunds quota for a real Claude response (accepted, rejected, or refusal)', async () => {
    mocks.callClaudeForSuggestion.mockResolvedValueOnce({
      status: 'ok',
      rawText: validContractJson(),
    });

    const result = await generateSuggestion(FAKE_SUPABASE, USER_ID, BASE_PARAMS);

    expect(result.status).toBe('generated');
    expect(mocks.decrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });
});
