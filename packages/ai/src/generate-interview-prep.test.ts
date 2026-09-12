import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnApplication: vi.fn(),
  listOwnRelevantStatusChangeEventsForApplication: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  getCurrentOwnRequirementMappingRun: vi.fn(),
  listCurrentOwnRequirementMappings: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  getOwnSubmissionPacketByApplicationId: vi.fn(),
  incrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForInterviewPrep: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  listOwnRelevantStatusChangeEventsForApplication:
    mocks.listOwnRelevantStatusChangeEventsForApplication,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  getCurrentOwnRequirementMappingRun: mocks.getCurrentOwnRequirementMappingRun,
  listCurrentOwnRequirementMappings: mocks.listCurrentOwnRequirementMappings,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  getOwnSubmissionPacketByApplicationId: mocks.getOwnSubmissionPacketByApplicationId,
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForInterviewPrep: mocks.callClaudeForInterviewPrep,
}));

const { generateInterviewPrep } = await import('./generate-interview-prep');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const FACT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '77777777-7777-4777-8777-777777777777';
const PARAMS = { applicationId: APPLICATION_ID };

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    userId: USER_ID,
    jobId: null,
    resumeId: null,
    company: 'Acme',
    title: 'Engineer',
    status: 'INTERVIEW',
    notes: null,
    appliedAt: '2026-01-01T00:00:00.000Z',
    location: null,
    sourceUrl: null,
    canonicalUrl: null,
    atsProvider: null,
    externalId: null,
    autofillSummary: null,
    unresolvedFields: null,
    jobSnapshotId: SNAPSHOT_ID,
    submissionPacketId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

const SNAPSHOT = {
  id: SNAPSHOT_ID,
  title: 'Engineer',
  company: 'Acme',
  description: 'Build things.',
  requiredQualifications: ['5 years of experience'],
  preferredQualifications: [],
  responsibilities: [],
  skills: [],
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

function prepJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rolePriorities: [],
    evidenceToEmphasize: [],
    starStoryPrompts: [],
    possibleQuestions: [],
    questionsToAsk: [],
    gapsToPrepare: [],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnApplication.mockResolvedValue(application());
  mocks.listOwnRelevantStatusChangeEventsForApplication.mockResolvedValue([]);
  mocks.getOwnJobSnapshot.mockResolvedValue(SNAPSHOT);
  mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue(null);
  mocks.listCurrentOwnRequirementMappings.mockResolvedValue([]);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([APPROVED_FACT]);
  mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(null);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.recordAiUsageEvent.mockResolvedValue({});
  mocks.callClaudeForInterviewPrep.mockResolvedValue({
    status: 'ok',
    rawText: prepJson(),
  });
});

describe('generateInterviewPrep — eligibility gate', () => {
  it('returns application_not_found without checking rate limit or calling Claude', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'application_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForInterviewPrep).not.toHaveBeenCalled();
  });

  it('returns action_not_current when the current status is not INTERVIEW (e.g. it became REJECTED since page load)', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ status: 'REJECTED' }));
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({
      status: 'action_not_current',
      currentActionType: 'NO_ACTION',
    });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('returns insufficient_context, without consuming rate limit, when there is no job snapshot id at all', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ jobSnapshotId: null }));
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'insufficient_context' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForInterviewPrep).not.toHaveBeenCalled();
  });
});

describe('generateInterviewPrep — rate limit', () => {
  it('returns rate_limited without calling Claude', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({
      ...ALLOWED_USAGE,
      allowed: false,
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.callClaudeForInterviewPrep).not.toHaveBeenCalled();
  });
});

describe('generateInterviewPrep — requirement mapping reuse and safe degrade', () => {
  it('never triggers requirement-mapping generation itself — only reads an existing CURRENT run', async () => {
    await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.getCurrentOwnRequirementMappingRun).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      SNAPSHOT_ID,
    );
    // No requirement-mapping generation function exists in this mock module at all — if the
    // pipeline tried to call one, this test's module mock would throw, not silently succeed.
  });

  it('degrades safely (usedCurrentRequirementMapping: false) when no CURRENT run exists', async () => {
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.usedCurrentRequirementMapping).toBe(false);
    }
    expect(mocks.listCurrentOwnRequirementMappings).not.toHaveBeenCalled();
  });

  it('reuses a CURRENT run and reports usedCurrentRequirementMapping: true when one exists', async () => {
    mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue({
      id: 'run-1',
      status: 'CURRENT',
    });
    mocks.listCurrentOwnRequirementMappings.mockResolvedValue([
      {
        id: REQUIREMENT_ID,
        requirementText: '5 years of experience',
        requiredOrPreferred: 'REQUIRED',
        relationship: 'DIRECT',
        matchedFacts: [
          {
            factId: FACT_ID,
            sourceTable: 'experiences',
            factUpdatedAt: '2026-01-01T00:00:00.000Z',
            validity: 'valid',
          },
        ],
      },
    ]);
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.usedCurrentRequirementMapping).toBe(true);
    }
  });

  it('produces a graceful, reduced result (no crash) when there are no approved candidate facts', async () => {
    mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([]);
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
  });
});

describe('generateInterviewPrep — frozen submission-packet answers', () => {
  it('includes submittedAnswersToReview only when a submission packet actually exists', async () => {
    mocks.getOwnApplication.mockResolvedValue(
      application({ submissionPacketId: 'packet-1' }),
    );
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      answersSnapshot: [
        {
          generatedAnswerId: 'ga-1',
          fieldLabel: 'Why us?',
          originalAnswer: 'Because.',
          finalText: 'Because I love it.',
        },
      ],
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.submittedAnswersToReview).toEqual([
        { fieldLabel: 'Why us?', answerText: 'Because I love it.' },
      ]);
    }
  });

  it('never fetches a submission packet when the application has no submissionPacketId', async () => {
    await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.getOwnSubmissionPacketByApplicationId).not.toHaveBeenCalled();
  });
});

describe('generateInterviewPrep — citation allowlist enforcement', () => {
  it('rejects and retries once when a sourceFactIds entry is outside the allowed fact list', async () => {
    mocks.callClaudeForInterviewPrep
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: prepJson({
          evidenceToEmphasize: [
            {
              theme: 'x',
              sourceFactIds: ['99999999-9999-4999-8999-999999999999'],
              summary: 'y',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: prepJson() });

    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForInterviewPrep).toHaveBeenCalledTimes(2);
  });

  it('rejects a sourceRequirementId outside the offered mappings, even when no mapping section exists at all', async () => {
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: prepJson({
        rolePriorities: [
          {
            requirement: 'x',
            importance: 'REQUIRED',
            sourceRequirementId: REQUIREMENT_ID,
          },
        ],
      }),
    });

    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForInterviewPrep).toHaveBeenCalledTimes(2);
  });

  it('returns validation_failed after both attempts fail malformed JSON', async () => {
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: 'not json',
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForInterviewPrep).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately with no retry', async () => {
    mocks.callClaudeForInterviewPrep.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForInterviewPrep).toHaveBeenCalledTimes(1);
  });
});

describe('generateInterviewPrep — usage telemetry and routing', () => {
  it('records an ai_usage_events row with task_type interview_prep and provider/model, and never fails the request if telemetry throws', async () => {
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({
        taskType: 'interview_prep',
        provider: 'anthropic',
        applicationId: APPLICATION_ID,
      }),
    );
  });
});
