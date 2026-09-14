import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnApplication: vi.fn(),
  getOwnResumeVersion: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  getCurrentOwnRequirementMappingRun: vi.fn(),
  listCurrentOwnRequirementMappings: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  incrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForResumeTailoring: vi.fn(),
  // Phase 7E application/résumé mutation-safety audit (§54) — none of these exist as call sites
  // in generate-resume-tailoring-plan.ts; if the module under test tried to call one, this mock
  // module would throw (the function isn't exported from it) rather than silently succeeding.
  changeOwnApplicationStatus: vi.fn(),
  markApplicationAppliedAtomic: vi.fn(),
  recordApplicationEvent: vi.fn(),
  revertApplicationEvent: vi.fn(),
  updateOwnApplication: vi.fn(),
  createOwnResumeVersion: vi.fn(),
  setOwnApplicationWorkingResumeVersion: vi.fn(),
  clearOwnApplicationWorkingResumeVersion: vi.fn(),
  deleteOwnResumeVersion: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  getOwnResumeVersion: mocks.getOwnResumeVersion,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  getCurrentOwnRequirementMappingRun: mocks.getCurrentOwnRequirementMappingRun,
  listCurrentOwnRequirementMappings: mocks.listCurrentOwnRequirementMappings,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
  changeOwnApplicationStatus: mocks.changeOwnApplicationStatus,
  markApplicationAppliedAtomic: mocks.markApplicationAppliedAtomic,
  recordApplicationEvent: mocks.recordApplicationEvent,
  revertApplicationEvent: mocks.revertApplicationEvent,
  updateOwnApplication: mocks.updateOwnApplication,
  createOwnResumeVersion: mocks.createOwnResumeVersion,
  setOwnApplicationWorkingResumeVersion: mocks.setOwnApplicationWorkingResumeVersion,
  clearOwnApplicationWorkingResumeVersion: mocks.clearOwnApplicationWorkingResumeVersion,
  deleteOwnResumeVersion: mocks.deleteOwnResumeVersion,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForResumeTailoring: mocks.callClaudeForResumeTailoring,
}));

const { generateResumeTailoringPlan } = await import('./generate-resume-tailoring-plan');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const RESUME_VERSION_ID = '88888888-8888-4888-8888-888888888888';
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
    status: 'IN_PROGRESS',
    notes: null,
    appliedAt: null,
    location: null,
    sourceUrl: null,
    canonicalUrl: null,
    atsProvider: null,
    externalId: null,
    autofillSummary: null,
    unresolvedFields: null,
    jobSnapshotId: SNAPSHOT_ID,
    submissionPacketId: null,
    workingResumeVersionId: RESUME_VERSION_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_RESUME = {
  schemaVersion: 1,
  header: { fullName: 'Ada Lovelace', email: null, phone: null, location: null, links: {} },
  education: [],
  experience: [
    {
      id: 'exp-1',
      organization: 'Acme',
      role: 'Engineer',
      location: null,
      dateRange: { start: null, end: null, isPresent: true },
      bullets: [{ id: 'b1', text: 'Built the referral workflow', provenance: { type: 'MANUAL' } }],
    },
  ],
  projects: [],
  leadership: [],
  skills: [{ id: 'skill-1', label: 'Languages', items: ['Python'] }],
  renderOverride: null,
};

function resumeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: RESUME_VERSION_ID,
    userId: USER_ID,
    resumeId: 'resume-1',
    versionNumber: 3,
    displayName: 'v3',
    snapshotFormat: 'STRUCTURED_V1',
    snapshotPayload: BASE_RESUME,
    createdAt: '2026-01-01T00:00:00.000Z',
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
  text: 'Built the referral workflow end to end at Acme.',
  tags: [],
  recencyDate: '2025-01-01',
  isOngoing: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function planJson(operations: unknown[] = []): string {
  return JSON.stringify({ operations });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnApplication.mockResolvedValue(application());
  mocks.getOwnResumeVersion.mockResolvedValue(resumeVersion());
  mocks.getOwnJobSnapshot.mockResolvedValue(SNAPSHOT);
  mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue(null);
  mocks.listCurrentOwnRequirementMappings.mockResolvedValue([]);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([APPROVED_FACT]);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.recordAiUsageEvent.mockResolvedValue({});
  mocks.callClaudeForResumeTailoring.mockResolvedValue({ status: 'ok', rawText: planJson() });
});

describe('generateResumeTailoringPlan — eligibility gate', () => {
  it('returns application_not_found without checking rate limit or calling Claude', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'application_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForResumeTailoring).not.toHaveBeenCalled();
  });

  it('returns no_working_resume when the application has no working résumé version selected', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ workingResumeVersionId: null }));
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'no_working_resume' });
    expect(mocks.getOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('returns no_working_resume defensively if the pointed-to version cannot be read', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue(null);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'no_working_resume' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('returns unsupported_resume_format for a METADATA_ONLY working resume, without calling Claude', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue(
      resumeVersion({ snapshotFormat: 'METADATA_ONLY', snapshotPayload: null }),
    );
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'unsupported_resume_format' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForResumeTailoring).not.toHaveBeenCalled();
  });

  it('returns missing_job_snapshot when the application has no jobSnapshotId at all', async () => {
    mocks.getOwnApplication.mockResolvedValue(application({ jobSnapshotId: null }));
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'missing_job_snapshot' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('returns missing_job_snapshot when the snapshot cannot be read', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue(null);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'missing_job_snapshot' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('re-derives the working résumé version server-side from the application row, never from a caller-supplied id', async () => {
    await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.getOwnResumeVersion).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      RESUME_VERSION_ID,
    );
  });
});

describe('generateResumeTailoringPlan — rate limit', () => {
  it('returns rate_limited without calling Claude', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.callClaudeForResumeTailoring).not.toHaveBeenCalled();
  });
});

describe('generateResumeTailoringPlan — requirement mapping reuse and safe degrade', () => {
  it('never triggers requirement-mapping generation itself — only reads an existing CURRENT run', async () => {
    await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.getCurrentOwnRequirementMappingRun).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      SNAPSHOT_ID,
    );
  });

  it('succeeds with reduced grounding (fallback requirement ids) when no CURRENT mapping run exists', async () => {
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.coverage.totalRequirementCount).toBe(1);
      // No real mapping run reused — never fabricated (Phase 7F §15 staleness anchor).
      expect(result.proposal.requirementMappingRunId).toBeNull();
    }
    expect(mocks.listCurrentOwnRequirementMappings).not.toHaveBeenCalled();
  });

  it('reuses a CURRENT mapping run and reflects its own MISSING relationship in coverage', async () => {
    mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue({ id: 'run-1', status: 'CURRENT' });
    mocks.listCurrentOwnRequirementMappings.mockResolvedValue([
      {
        id: REQUIREMENT_ID,
        requirementText: '5 years of experience',
        requiredOrPreferred: 'REQUIRED',
        relationship: 'MISSING',
        matchedFacts: [],
      },
    ]);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.coverage.unsupportedRequirementIds).toEqual([REQUIREMENT_ID]);
      expect(result.proposal.requirementMappingRunId).toBe('run-1');
    }
  });
});

describe('generateResumeTailoringPlan — grounding and allowlist enforcement', () => {
  it('rejects and retries once when a cited sourceFactId is outside the offered fact list', async () => {
    mocks.callClaudeForResumeTailoring
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: planJson([
          {
            type: 'REWRITE_BULLET',
            bulletId: 'b1',
            proposedText: 'Rewritten',
            sourceFactIds: ['99999999-9999-4999-8999-999999999999'],
            requirementIds: [],
            reason: 'x',
          },
        ]),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: planJson() });

    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(2);
  });

  it('rejects and never applies a plan that introduces an ungrounded number', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Improved workflow performance by 80%',
          sourceFactIds: [],
          requirementIds: [],
          reason: 'x',
        },
      ]),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(2);
  });

  it('rejects and never applies a plan that introduces an ungrounded technology', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built the referral workflow using Snowflake',
          sourceFactIds: [],
          requirementIds: [],
          reason: 'x',
        },
      ]),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
  });

  it('rejects ADD_BULLET with no citations at the shape layer and retries', async () => {
    mocks.callClaudeForResumeTailoring
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: JSON.stringify({
          operations: [
            {
              type: 'ADD_BULLET',
              entryId: 'exp-1',
              proposedText: 'New bullet',
              sourceFactIds: [],
              requirementIds: [],
              reason: 'x',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: planJson() });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(2);
  });

  it('returns validation_failed after both attempts fail malformed JSON', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValue({ status: 'ok', rawText: 'not json' });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(2);
  });

  it('returns provider_error immediately with no retry', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(1);
  });
});

describe('generateResumeTailoringPlan — successful proposal', () => {
  it('applies a valid plan and returns a fully server-computed, ephemeral proposal', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Rewritten with real evidence',
          sourceFactIds: [FACT_ID],
          requirementIds: [],
          reason: 'x',
        },
      ]),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.proposal.baseResumeVersionId).toBe(RESUME_VERSION_ID);
    expect(result.proposal.baseResumeVersionNumber).toBe(3);
    // Phase 7F staleness anchors — server-derived, never trusted from the caller (§15).
    expect(result.proposal.jobSnapshotId).toBe(SNAPSHOT_ID);
    // Phase 7F's client-side live preview needs the exact base content operations were computed
    // against (§12/§46) — the same object the pipeline already fetched, never re-derived.
    expect(result.proposal.baseResume).toBe(BASE_RESUME);
    expect(result.proposal.customLatexOverridePresent).toBe(false);
    expect(result.proposal.summary.rewrittenBullets).toBe(1);
    expect(result.proposal.proposedResumeLatex).toContain('Rewritten with real evidence');
    // The original bullet text must not survive into the proposal's rendered LaTeX.
    expect(result.proposal.proposedResumeLatex).not.toContain('Built the referral workflow');
  });

  it('reports customLatexOverridePresent: true when the base version has an active override, without ever using it for the proposal', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue(
      resumeVersion({
        snapshotPayload: { ...BASE_RESUME, renderOverride: { latex: '\\documentclass{article}' } },
      }),
    );
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.customLatexOverridePresent).toBe(true);
      // Still the structured-content render, never the raw override string.
      expect(result.proposal.proposedResumeLatex).not.toBe('\\documentclass{article}');
    }
  });
});

describe('generateResumeTailoringPlan — usage telemetry', () => {
  it('records an ai_usage_events row with task_type resume_tailoring, and never fails the request if telemetry throws', async () => {
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({
        taskType: 'resume_tailoring',
        provider: 'anthropic',
        applicationId: APPLICATION_ID,
      }),
    );
  });
});

describe('generateResumeTailoringPlan — no state mutation (Phase 7E §21/§45/§54 audit)', () => {
  it('never mutates any résumé, application, or submission-packet state on success', async () => {
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.createOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.setOwnApplicationWorkingResumeVersion).not.toHaveBeenCalled();
    expect(mocks.clearOwnApplicationWorkingResumeVersion).not.toHaveBeenCalled();
    expect(mocks.deleteOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.updateOwnApplication).not.toHaveBeenCalled();
    expect(mocks.changeOwnApplicationStatus).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
    expect(mocks.revertApplicationEvent).not.toHaveBeenCalled();
  });

  it('never mutates any state even when the response is rejected/retried', async () => {
    mocks.callClaudeForResumeTailoring.mockResolvedValue({ status: 'ok', rawText: 'not json' });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.createOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.setOwnApplicationWorkingResumeVersion).not.toHaveBeenCalled();
    expect(mocks.updateOwnApplication).not.toHaveBeenCalled();
  });
});
