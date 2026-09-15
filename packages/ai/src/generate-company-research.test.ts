import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnApplication: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  getCurrentOwnRequirementMappingRun: vi.fn(),
  listCurrentOwnRequirementMappings: vi.fn(),
  incrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  createCompanyResearchSnapshot: vi.fn(),
  discoverAndExtractCompanyResearchSources: vi.fn(),
  callClaudeForCompanyResearch: vi.fn(),
  // Mutation-audit (§61) — none of these exist as call sites in generate-company-research.ts; if
  // the module under test tried to call one, this mock module would throw (the function isn't
  // exported from it) rather than silently succeeding.
  createOwnResumeVersion: vi.fn(),
  saveReviewedTailoredResume: vi.fn(),
  setOwnApplicationWorkingResumeVersion: vi.fn(),
  markApplicationAppliedAtomic: vi.fn(),
  createOwnContactInteraction: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  getCurrentOwnRequirementMappingRun: mocks.getCurrentOwnRequirementMappingRun,
  listCurrentOwnRequirementMappings: mocks.listCurrentOwnRequirementMappings,
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
  createCompanyResearchSnapshot: mocks.createCompanyResearchSnapshot,
  createOwnResumeVersion: mocks.createOwnResumeVersion,
  saveReviewedTailoredResume: mocks.saveReviewedTailoredResume,
  setOwnApplicationWorkingResumeVersion: mocks.setOwnApplicationWorkingResumeVersion,
  markApplicationAppliedAtomic: mocks.markApplicationAppliedAtomic,
  createOwnContactInteraction: mocks.createOwnContactInteraction,
}));

vi.mock('./research/discover-and-extract-company-research-sources', () => ({
  discoverAndExtractCompanyResearchSources:
    mocks.discoverAndExtractCompanyResearchSources,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForCompanyResearch: mocks.callClaudeForCompanyResearch,
}));

const { generateCompanyResearch } = await import('./generate-company-research');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_ID = '55555555-5555-4555-8555-555555555555';
const PARAMS = { applicationId: APPLICATION_ID };

function baseApplication(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: APPLICATION_ID,
    company: 'Acme',
    title: 'Product Manager Intern',
    jobSnapshotId: null,
    ...overrides,
  };
}

function discoveredSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SOURCE_ID,
    url: 'https://acme.com/news',
    canonicalUrl: 'https://acme.com/news',
    title: 'Acme News',
    publisher: 'acme.com',
    sourceType: 'OFFICIAL_NEWSROOM',
    publishedAt: null,
    text: 'Acme launched a new AI product.',
    contentHash: 'abc123',
    ...overrides,
  };
}

function planJson(findings: unknown[] = []) {
  return JSON.stringify({ findings });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnApplication.mockResolvedValue(baseApplication());
  mocks.incrementOwnAiRequestUsage.mockResolvedValue({
    allowed: true,
    aiRequestsThisPeriod: 1,
    aiRequestLimit: 50,
    aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
  });
  mocks.getOwnJobSnapshot.mockResolvedValue(null);
  mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue(null);
  mocks.discoverAndExtractCompanyResearchSources.mockResolvedValue({
    status: 'ok',
    sources: [discoveredSource()],
  });
  mocks.recordAiUsageEvent.mockResolvedValue(undefined);
  mocks.createCompanyResearchSnapshot.mockResolvedValue({
    snapshotId: '66666666-6666-4666-8666-666666666666',
    sourceCount: 1,
    findingCount: 1,
  });
});

describe('generateCompanyResearch — eligibility and rate limiting', () => {
  it('returns application_not_found before any external call when the application does not exist', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'application_not_found' });
    expect(mocks.incrementOwnAiRequestUsage).not.toHaveBeenCalled();
    expect(mocks.discoverAndExtractCompanyResearchSources).not.toHaveBeenCalled();
  });

  it('returns rate_limited before any search/AI call when the limit is reached', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({
      allowed: false,
      aiRequestsThisPeriod: 50,
      aiRequestLimit: 50,
      aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.discoverAndExtractCompanyResearchSources).not.toHaveBeenCalled();
    expect(mocks.callClaudeForCompanyResearch).not.toHaveBeenCalled();
  });
});

describe('generateCompanyResearch — web retrieval outcomes (no AI call, no telemetry)', () => {
  it('returns research_provider_unavailable and never calls Claude', async () => {
    mocks.discoverAndExtractCompanyResearchSources.mockResolvedValue({
      status: 'research_provider_unavailable',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'research_provider_unavailable' });
    expect(mocks.callClaudeForCompanyResearch).not.toHaveBeenCalled();
    expect(mocks.recordAiUsageEvent).not.toHaveBeenCalled();
  });

  it('returns no_useful_sources and never calls Claude', async () => {
    mocks.discoverAndExtractCompanyResearchSources.mockResolvedValue({
      status: 'no_useful_sources',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'no_useful_sources' });
    expect(mocks.callClaudeForCompanyResearch).not.toHaveBeenCalled();
  });

  it('returns insufficient_source_evidence and never calls Claude', async () => {
    mocks.discoverAndExtractCompanyResearchSources.mockResolvedValue({
      status: 'insufficient_source_evidence',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'insufficient_source_evidence' });
  });

  it('maps a search-layer provider error to search_provider_error', async () => {
    mocks.discoverAndExtractCompanyResearchSources.mockResolvedValue({
      status: 'provider_error',
      message: 'timeout',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'search_provider_error', message: 'timeout' });
  });
});

describe('generateCompanyResearch — AI synthesis, validation, and retry', () => {
  it('succeeds, resolves cited sources, and persists via the atomic RPC', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'ok',
      rawText: planJson([
        {
          category: 'PRODUCT',
          claim: 'Acme launched a new AI product.',
          roleRelevance: 'Relevant to this PM role.',
          sourceIds: [SOURCE_ID],
          requirementIds: [],
        },
      ]),
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.snapshot.findings).toHaveLength(1);
    expect(result.snapshot.findings[0]?.sources[0]?.id).toBe(SOURCE_ID);
    expect(mocks.createCompanyResearchSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.callClaudeForCompanyResearch).toHaveBeenCalledTimes(1);
  });

  it('rejects and retries once when a finding cites an unknown source id, never persisting the first attempt', async () => {
    mocks.callClaudeForCompanyResearch
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: planJson([
          {
            category: 'PRODUCT',
            claim: 'x',
            sourceIds: ['99999999-9999-4999-8999-999999999999'],
          },
        ]),
      })
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: planJson([{ category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID] }]),
      });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForCompanyResearch).toHaveBeenCalledTimes(2);
  });

  it('returns invalid_research_output after both attempts fail, and records rejected telemetry', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'ok',
      rawText: 'not json',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'invalid_research_output' });
    expect(mocks.callClaudeForCompanyResearch).toHaveBeenCalledTimes(2);
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ taskType: 'company_research', outcome: 'rejected' }),
    );
    expect(mocks.createCompanyResearchSnapshot).not.toHaveBeenCalled();
  });

  it('returns ai_provider_unavailable immediately with no retry on a provider error', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'provider_error',
      message: 'down',
    });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'ai_provider_unavailable', message: 'down' });
    expect(mocks.callClaudeForCompanyResearch).toHaveBeenCalledTimes(1);
  });

  it('rejects a plan with zero findings and retries once', async () => {
    mocks.callClaudeForCompanyResearch
      .mockResolvedValueOnce({ status: 'ok', rawText: planJson([]) })
      .mockResolvedValueOnce({
        status: 'ok',
        rawText: planJson([{ category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID] }]),
      });
    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForCompanyResearch).toHaveBeenCalledTimes(2);
  });
});

describe('generateCompanyResearch — staleness protection', () => {
  it('returns stale_application_context and never persists when the company changed mid-research', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'ok',
      rawText: planJson([{ category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID] }]),
    });
    mocks.getOwnApplication
      .mockResolvedValueOnce(baseApplication()) // initial read
      .mockResolvedValueOnce(baseApplication({ company: 'Different Co' })); // re-check before persistence

    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'stale_application_context' });
    expect(mocks.createCompanyResearchSnapshot).not.toHaveBeenCalled();
  });

  it('returns stale_application_context when the application was deleted mid-research', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'ok',
      rawText: planJson([{ category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID] }]),
    });
    mocks.getOwnApplication
      .mockResolvedValueOnce(baseApplication())
      .mockResolvedValueOnce(null);

    const result = await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'stale_application_context' });
    expect(mocks.createCompanyResearchSnapshot).not.toHaveBeenCalled();
  });
});

describe('generateCompanyResearch — no candidate facts, no résumé/interview-prep mutation', () => {
  it('never calls any résumé/application-mutation/interview-prep function', async () => {
    mocks.callClaudeForCompanyResearch.mockResolvedValue({
      status: 'ok',
      rawText: planJson([{ category: 'PRODUCT', claim: 'x', sourceIds: [SOURCE_ID] }]),
    });
    await generateCompanyResearch(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(mocks.createOwnResumeVersion).not.toHaveBeenCalled();
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
    expect(mocks.setOwnApplicationWorkingResumeVersion).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    expect(mocks.createOwnContactInteraction).not.toHaveBeenCalled();
  });
});
