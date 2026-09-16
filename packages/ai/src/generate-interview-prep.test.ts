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
  decrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForInterviewPrep: vi.fn(),
  // Phase 5C.4 application-state safety audit — see generate-follow-up-draft.test.ts's identical
  // block for the full rationale.
  changeOwnApplicationStatus: vi.fn(),
  markApplicationAppliedAtomic: vi.fn(),
  recordApplicationEvent: vi.fn(),
  revertApplicationEvent: vi.fn(),
  updateOwnApplication: vi.fn(),
  // Phase 7I
  getOwnCompanyResearchSnapshot: vi.fn(),
  listOwnCompanyResearchSnapshotsForApplication: vi.fn(),
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
  decrementOwnAiRequestUsage: mocks.decrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
  changeOwnApplicationStatus: mocks.changeOwnApplicationStatus,
  markApplicationAppliedAtomic: mocks.markApplicationAppliedAtomic,
  recordApplicationEvent: mocks.recordApplicationEvent,
  revertApplicationEvent: mocks.revertApplicationEvent,
  updateOwnApplication: mocks.updateOwnApplication,
  getOwnCompanyResearchSnapshot: mocks.getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication: mocks.listOwnCompanyResearchSnapshotsForApplication,
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

const RESEARCH_SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FINDING_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function companyResearchSnapshot(overrides: Record<string, unknown> = {}) {
  const source = {
    id: SOURCE_ID,
    url: 'https://acme.example/engineering-blog/data-platform',
    canonicalUrl: null,
    title: 'Acme engineering blog: our data platform',
    publisher: 'Acme',
    sourceType: 'ENGINEERING_BLOG',
    publishedAt: null,
    retrievedAt: '2026-09-10T00:00:00.000Z',
    evidenceExcerpt: null,
    contentHash: null,
  };
  return {
    id: RESEARCH_SNAPSHOT_ID,
    userId: USER_ID,
    applicationId: APPLICATION_ID,
    companyName: 'Acme',
    roleTitle: 'Engineer',
    jobSnapshotId: SNAPSHOT_ID,
    researchedAt: '2026-09-10T00:00:00.000Z',
    createdAt: '2026-09-10T00:00:00.000Z',
    findings: [
      {
        id: FINDING_ID,
        category: 'TECHNOLOGY',
        claim: 'Acme is expanding its Snowflake-based analytics platform.',
        roleRelevance: 'This role works directly with the data platform.',
        requirementIds: [],
        sources: [source],
      },
    ],
    sources: [source],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrementOwnAiRequestUsage.mockResolvedValue(undefined);
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
  mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(null);
  mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
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

  it('refunds the reserved quota unit on a provider_error (real incident regression)', async () => {
    mocks.callClaudeForInterviewPrep.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });
    await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledWith(FAKE_SUPABASE, USER_ID);
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

describe('generateInterviewPrep — application-state safety (Phase 5C.4 audit)', () => {
  it('never calls any function that could mutate application status, applied_at, submission_packet_id, packet content, or event history — success path', async () => {
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.changeOwnApplicationStatus).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
    expect(mocks.revertApplicationEvent).not.toHaveBeenCalled();
    expect(mocks.updateOwnApplication).not.toHaveBeenCalled();
  });

  it('never calls any mutating function even when the response is rejected/retried', async () => {
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: 'not json',
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.changeOwnApplicationStatus).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
    expect(mocks.revertApplicationEvent).not.toHaveBeenCalled();
    expect(mocks.updateOwnApplication).not.toHaveBeenCalled();
  });
});

describe('generateInterviewPrep — Phase 7I research-aware interview prep', () => {
  it('behaves exactly like plain 5C.3B when researchMode is omitted (default JOB_ONLY) — never reads research', async () => {
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.researchMode).toBe('JOB_ONLY');
      expect(result.prep.companyResearchSnapshotId).toBeNull();
      expect(result.prep.companyResearchResearchedAt).toBeNull();
      expect(result.prep.selectedResearchFindingCount).toBe(0);
      expect(result.prep.researchFindingsReferenced).toBe(0);
      expect(result.prep.itemsInfluencedByResearch).toBe(0);
    }
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
    expect(mocks.listOwnCompanyResearchSnapshotsForApplication).not.toHaveBeenCalled();
  });

  it('explicit JOB_ONLY ignores any supplied companyResearchSnapshotId entirely', async () => {
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_ONLY',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.researchMode).toBe('JOB_ONLY');
    }
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
  });

  it('degrades honestly to JOB_ONLY (never an error) when JOB_PLUS_COMPANY_RESEARCH is requested with no explicit id and no compatible snapshot exists', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.researchMode).toBe('JOB_ONLY');
      expect(result.prep.companyResearchSnapshotId).toBeNull();
    }
  });

  it('degrades honestly to JOB_ONLY when only incompatible (stale) snapshots exist for the auto-resolve path', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: RESEARCH_SNAPSHOT_ID,
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-10T00:00:00.000Z',
        findingCount: 1,
        sourceCount: 1,
      },
    ]);
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(
      companyResearchSnapshot({ companyName: 'A Totally Different Company' }),
    );
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.researchMode).toBe('JOB_ONLY');
    }
  });

  it('returns research_snapshot_not_found for an explicit id that does not resolve, without spending quota', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(null);
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'research_snapshot_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForInterviewPrep).not.toHaveBeenCalled();
  });

  it('returns stale_company_research for an explicit id whose frozen company no longer matches — never silently used', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(
      companyResearchSnapshot({ companyName: 'A Totally Different Company' }),
    );
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'stale_company_research' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('R1 generated, then R2 created — a still-explicit request for R1 remains valid (snapshot identity, not latestness)', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.companyResearchSnapshotId).toBe(RESEARCH_SNAPSHOT_ID);
    }
    expect(mocks.listOwnCompanyResearchSnapshotsForApplication).not.toHaveBeenCalled();
  });

  it('auto-resolves the latest compatible snapshot when no explicit id is given', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([
      {
        id: RESEARCH_SNAPSHOT_ID,
        companyName: 'Acme',
        roleTitle: 'Engineer',
        researchedAt: '2026-09-10T00:00:00.000Z',
        findingCount: 1,
        sourceCount: 1,
      },
    ]);
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prep.researchMode).toBe('JOB_PLUS_COMPANY_RESEARCH');
      expect(result.prep.companyResearchSnapshotId).toBe(RESEARCH_SNAPSHOT_ID);
      expect(result.prep.companyResearchResearchedAt).toBe('2026-09-10T00:00:00.000Z');
      expect(result.prep.selectedResearchFindingCount).toBe(1);
    }
  });

  it('resolves a valid researchFindingIds citation into companyRelevance without it grounding any claim', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: prepJson({
        questionsToAsk: [
          {
            question: 'How is the analytics platform investment going?',
            rationale: 'Shows genuine interest in a current company priority',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.prep.itemsInfluencedByResearch).toBe(1);
    expect(result.prep.researchFindingsReferenced).toBe(1);
    expect(result.prep.questionsToAsk[0]?.companyRelevance).toEqual([
      {
        id: FINDING_ID,
        claim: 'Acme is expanding its Snowflake-based analytics platform.',
        roleRelevance: 'This role works directly with the data platform.',
        category: 'TECHNOLOGY',
      },
    ]);
    // Raw ids never leak into the final result.
    expect(result.prep.questionsToAsk[0]).not.toHaveProperty('researchFindingIds');
  });

  it('rejects and retries a plan citing a research finding id outside this request\'s snapshot', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForInterviewPrep
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: prepJson({
          gapsToPrepare: [
            {
              requirement: 'x',
              sourceRequirementId: null,
              note: 'y',
              researchFindingIds: ['99999999-9999-4999-8999-999999999999'],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: prepJson() });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForInterviewPrep).toHaveBeenCalledTimes(2);
  });

  it('CRITICAL: a company-research finding about a technology never grounds a candidate technology claim, even when cited', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: prepJson({
        evidenceToEmphasize: [
          {
            theme: 'Data platform',
            sourceFactIds: [FACT_ID],
            summary: 'Emphasize your Snowflake pipeline experience',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    // Rejected on both attempts — citing the finding does not satisfy the technology guard.
    expect(result).toEqual({ status: 'validation_failed' });
  });

  it('CRITICAL: a large company metric never grounds a candidate-specific metric claim', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: prepJson({
        starStoryPrompts: [
          {
            competency: 'Scale',
            sourceFactIds: [FACT_ID],
            prompt: 'Tell them about driving $10B in company revenue',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
    });
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'validation_failed' });
  });

  it('research may still influence a legitimate candidate fact that is independently grounded', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForInterviewPrep.mockResolvedValue({
      status: 'ok',
      rawText: prepJson({
        evidenceToEmphasize: [
          {
            theme: 'Kubernetes migration',
            sourceFactIds: [FACT_ID],
            summary: 'Discuss the Kubernetes migration you led at Acme',
            researchFindingIds: [FINDING_ID],
          },
        ],
      }),
    });
    // APPROVED_FACT's own text is "Led the Kubernetes migration at Acme." — genuinely grounded.
    const result = await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
  });

  it('never makes an extra provider/search call for research-aware prep — still at most 2 Claude calls, zero elsewhere', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    await generateInterviewPrep(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(mocks.callClaudeForInterviewPrep.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ taskType: 'interview_prep' }),
    );
  });

  it('refreshing research never happens automatically — this pipeline only reads what it is explicitly told to', async () => {
    await generateInterviewPrep(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.listOwnCompanyResearchSnapshotsForApplication).not.toHaveBeenCalled();
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
  });
});
