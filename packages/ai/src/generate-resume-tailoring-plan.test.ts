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
  // Phase 7H
  getOwnCompanyResearchSnapshot: vi.fn(),
  listOwnCompanyResearchSnapshotsForApplication: vi.fn(),
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
  getOwnCompanyResearchSnapshot: mocks.getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication: mocks.listOwnCompanyResearchSnapshotsForApplication,
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
        claim: 'Acme uses Snowflake for its data platform.',
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
  mocks.getOwnApplication.mockResolvedValue(application());
  mocks.getOwnResumeVersion.mockResolvedValue(resumeVersion());
  mocks.getOwnJobSnapshot.mockResolvedValue(SNAPSHOT);
  mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue(null);
  mocks.listCurrentOwnRequirementMappings.mockResolvedValue([]);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([APPROVED_FACT]);
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.recordAiUsageEvent.mockResolvedValue({});
  mocks.callClaudeForResumeTailoring.mockResolvedValue({ status: 'ok', rawText: planJson() });
  mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(null);
  mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
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

describe('generateResumeTailoringPlan — Phase 7H research-aware tailoring', () => {
  it('behaves exactly like plain 7E when researchMode is omitted (default JOB_ONLY) — never reads research', async () => {
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.researchMode).toBe('JOB_ONLY');
      expect(result.proposal.companyResearchSnapshotId).toBeNull();
      expect(result.proposal.companyResearchResearchedAt).toBeNull();
      expect(result.proposal.selectedResearchFindingCount).toBe(0);
    }
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
    expect(mocks.listOwnCompanyResearchSnapshotsForApplication).not.toHaveBeenCalled();
  });

  it('explicit JOB_ONLY ignores any supplied companyResearchSnapshotId entirely', async () => {
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_ONLY',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.researchMode).toBe('JOB_ONLY');
    }
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
  });

  it('degrades honestly to JOB_ONLY (never an error) when JOB_PLUS_COMPANY_RESEARCH is requested with no explicit id and no compatible snapshot exists', async () => {
    mocks.listOwnCompanyResearchSnapshotsForApplication.mockResolvedValue([]);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.researchMode).toBe('JOB_ONLY');
      expect(result.proposal.companyResearchSnapshotId).toBeNull();
    }
  });

  it('returns research_snapshot_not_found for an explicit id that does not resolve, without spending quota', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(null);
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'research_snapshot_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.callClaudeForResumeTailoring).not.toHaveBeenCalled();
  });

  it('returns stale_company_research for an explicit id whose frozen company no longer matches — never silently used', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(
      companyResearchSnapshot({ companyName: 'A Totally Different Company' }),
    );
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'stale_company_research' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
  });

  it('R1 generated, then R2 created — a still-explicit request for R1 remains valid (snapshot identity, not latestness)', async () => {
    // Only R1 is ever fetched by id here; R2's mere existence elsewhere must not matter — this
    // pipeline never looks at "the latest snapshot" when an explicit id was requested (§9).
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.companyResearchSnapshotId).toBe(RESEARCH_SNAPSHOT_ID);
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
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.proposal.researchMode).toBe('JOB_PLUS_COMPANY_RESEARCH');
      expect(result.proposal.companyResearchSnapshotId).toBe(RESEARCH_SNAPSHOT_ID);
      expect(result.proposal.companyResearchResearchedAt).toBe('2026-09-10T00:00:00.000Z');
      expect(result.proposal.selectedResearchFindingCount).toBe(1);
    }
  });

  it('resolves a valid researchFindingIds citation into companyRelevance without it grounding any claim', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          type: 'MOVE_BULLET',
          bulletId: 'b1',
          targetIndex: 0,
          researchFindingIds: [FINDING_ID],
          reason: 'Company research shows this is a current priority',
        },
      ]),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.proposal.summary.operationsInfluencedByResearch).toBe(1);
    expect(result.proposal.summary.researchFindingsReferenced).toBe(1);
    const op = result.proposal.operations[0];
    expect(op?.type).toBe('MOVE_BULLET');
    if (op?.type === 'MOVE_BULLET') {
      expect(op.companyRelevance).toEqual([
        {
          id: FINDING_ID,
          claim: 'Acme uses Snowflake for its data platform.',
          roleRelevance: 'This role works directly with the data platform.',
          category: 'TECHNOLOGY',
        },
      ]);
    }
  });

  it('rejects and retries a plan citing a research finding id outside this request\'s snapshot', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForResumeTailoring
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: planJson([
          {
            type: 'OMIT_BULLET',
            bulletId: 'b1',
            researchFindingIds: ['99999999-9999-4999-8999-999999999999'],
            reason: 'x',
          },
        ]),
      })
      .mockResolvedValueOnce({ status: 'ok', rawText: planJson() });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForResumeTailoring).toHaveBeenCalledTimes(2);
  });

  it('CRITICAL: a company-research finding about a technology never grounds a candidate technology claim, even when cited', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Built analytics pipelines using Snowflake',
          sourceFactIds: [],
          requirementIds: [],
          researchFindingIds: [FINDING_ID],
          reason: 'Aligning with the company\'s data platform focus',
        },
      ]),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    // Rejected on both attempts — citing the finding does not satisfy the technology guard.
    expect(result).toEqual({ status: 'validation_failed' });
  });

  it('CRITICAL: ADD_BULLET with only researchFindingIds and no sourceFactIds is rejected at the shape layer', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    mocks.callClaudeForResumeTailoring.mockResolvedValue({
      status: 'ok',
      rawText: JSON.stringify({
        operations: [
          {
            type: 'ADD_BULLET',
            entryId: 'exp-1',
            proposedText: 'Worked on the data platform',
            sourceFactIds: [],
            requirementIds: [],
            researchFindingIds: [FINDING_ID],
            reason: 'x',
          },
        ],
      }),
    });
    const result = await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(result).toEqual({ status: 'validation_failed' });
  });

  it('never makes an extra provider/search call for research-aware tailoring — still at most 2 Claude calls, zero elsewhere', async () => {
    mocks.getOwnCompanyResearchSnapshot.mockResolvedValue(companyResearchSnapshot());
    await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, {
      ...PARAMS,
      researchMode: 'JOB_PLUS_COMPANY_RESEARCH',
      companyResearchSnapshotId: RESEARCH_SNAPSHOT_ID,
    });
    expect(mocks.callClaudeForResumeTailoring.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ taskType: 'resume_tailoring' }),
    );
  });

  it('refreshing research (a new R2 existing) never happens automatically — this pipeline only reads what it is explicitly told to', async () => {
    // No explicit id, JOB_ONLY requested — even though a compatible snapshot exists, it is never
    // looked at because the user never asked for it.
    await generateResumeTailoringPlan(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.listOwnCompanyResearchSnapshotsForApplication).not.toHaveBeenCalled();
    expect(mocks.getOwnCompanyResearchSnapshot).not.toHaveBeenCalled();
  });
});
