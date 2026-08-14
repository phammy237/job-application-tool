import type { CareerOsSupabaseClient } from '@career-os/database';
import type { JobSnapshot } from '@career-os/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incrementOwnAiRequestUsage: vi.fn(),
  getOwnJobSnapshot: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  createOwnPendingRequirementMappingRun: vi.fn(),
  markOwnRequirementMappingRunFailed: vi.fn(),
  promoteOwnRequirementMappingRun: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForRequirementMapping: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  getOwnJobSnapshot: mocks.getOwnJobSnapshot,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  createOwnPendingRequirementMappingRun: mocks.createOwnPendingRequirementMappingRun,
  markOwnRequirementMappingRunFailed: mocks.markOwnRequirementMappingRunFailed,
  promoteOwnRequirementMappingRun: mocks.promoteOwnRequirementMappingRun,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForRequirementMapping: mocks.callClaudeForRequirementMapping,
}));

const { generateRequirementMapping } = await import('./generate-requirement-mapping');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = 'snap-1';
const RUN_ID = 'run-1';
const FACT_ID = '11111111-1111-4111-8111-111111111111';

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 50,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

const SNAPSHOT: JobSnapshot = {
  id: SNAPSHOT_ID,
  userId: USER_ID,
  sourceJobId: 'job-1',
  company: 'Acme',
  title: 'Backend Engineer',
  location: null,
  employmentType: null,
  sourceUrl: null,
  externalId: null,
  description: 'Build the payments service.',
  requiredQualifications: [],
  preferredQualifications: [],
  responsibilities: [],
  skills: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  locations: [],
  workMode: null,
  remoteLocationRestrictions: null,
  workAuthorizationLanguage: null,
  sourceType: 'GENERIC',
  contentFingerprint: 'v1:abc',
  contentTruncated: false,
  truncatedFields: [],
  capturedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const RELEVANT_FACT = {
  id: FACT_ID,
  sourceTable: 'experiences' as const,
  category: 'EXPERIENCE',
  text: 'Built the payments service.',
  tags: [],
  recencyDate: '2025-01-01',
  isOngoing: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function validMappingJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      requirementText: '5+ years of backend experience',
      requirementCategory: 'EXPERIENCE',
      requiredOrPreferred: 'REQUIRED',
      relationship: 'DIRECT',
      matchedFactIds: [FACT_ID],
      explanation: 'Matches the Acme backend role.',
      confidence: 0.9,
      requiresUserConfirmation: false,
      ...overrides,
    },
  ]);
}

const PARAMS = { jobSnapshotId: SNAPSHOT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.getOwnJobSnapshot.mockResolvedValue(SNAPSHOT);
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([RELEVANT_FACT]);
  mocks.createOwnPendingRequirementMappingRun.mockResolvedValue(RUN_ID);
  mocks.markOwnRequirementMappingRunFailed.mockResolvedValue(true);
  mocks.promoteOwnRequirementMappingRun.mockResolvedValue({ runId: RUN_ID, mappingCount: 1 });
  mocks.recordAiUsageEvent.mockResolvedValue({});
});

describe('generateRequirementMapping — rate limit', () => {
  it('short-circuits before any retrieval, run creation, or Claude call', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });
    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result.status).toBe('rate_limited');
    expect(mocks.getOwnJobSnapshot).not.toHaveBeenCalled();
    expect(mocks.createOwnPendingRequirementMappingRun).not.toHaveBeenCalled();
    expect(mocks.callClaudeForRequirementMapping).not.toHaveBeenCalled();
  });
});

describe('generateRequirementMapping — retrieval', () => {
  it('returns snapshot_not_found when the snapshot does not exist or is not owned by the caller', async () => {
    mocks.getOwnJobSnapshot.mockResolvedValue(null);
    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'snapshot_not_found' });
    expect(mocks.callClaudeForRequirementMapping).not.toHaveBeenCalled();
  });

  it('returns insufficient_facts without calling Claude when no approved facts exist', async () => {
    mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([]);
    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);
    expect(result).toEqual({ status: 'insufficient_facts' });
    expect(mocks.callClaudeForRequirementMapping).not.toHaveBeenCalled();
    expect(mocks.createOwnPendingRequirementMappingRun).not.toHaveBeenCalled();
  });
});

describe('generateRequirementMapping — success path', () => {
  it('creates a PENDING run, calls Claude once, and promotes on the first valid attempt', async () => {
    mocks.callClaudeForRequirementMapping.mockResolvedValueOnce({
      status: 'ok',
      rawText: validMappingJson(),
    });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'promoted', runId: RUN_ID, mappingCount: 1 });
    expect(mocks.createOwnPendingRequirementMappingRun).toHaveBeenCalledTimes(1);
    expect(mocks.callClaudeForRequirementMapping).toHaveBeenCalledTimes(1);
    expect(mocks.promoteOwnRequirementMappingRun).toHaveBeenCalledTimes(1);
    expect(mocks.markOwnRequirementMappingRunFailed).not.toHaveBeenCalled();
  });

  it('attaches server-derived provenance (sourceTable, factUpdatedAt) to the promoted payload, never trusting the model for it', async () => {
    mocks.callClaudeForRequirementMapping.mockResolvedValueOnce({
      status: 'ok',
      rawText: validMappingJson(),
    });

    await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    const [, , , payload] = mocks.promoteOwnRequirementMappingRun.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      Array<{ matchedFacts: Array<{ factId: string; sourceTable: string; factUpdatedAt: string }> }>,
    ];
    expect(payload[0]!.matchedFacts).toEqual([
      { factId: FACT_ID, sourceTable: 'experiences', factUpdatedAt: RELEVANT_FACT.updatedAt },
    ]);
  });
});

describe('generateRequirementMapping — rejection gate and retry-once', () => {
  it('retries once and promotes when attempt 2 passes validation', async () => {
    mocks.callClaudeForRequirementMapping
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validMappingJson() });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('promoted');
    expect(mocks.callClaudeForRequirementMapping).toHaveBeenCalledTimes(2);
  });

  it('retries once on a refusal and succeeds if the retry passes', async () => {
    mocks.callClaudeForRequirementMapping
      .mockResolvedValueOnce({ status: 'refusal', category: 'cyber' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validMappingJson() });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('promoted');
    expect(mocks.callClaudeForRequirementMapping).toHaveBeenCalledTimes(2);
  });

  it('marks the run FAILED and returns validation_failed when both attempts fail — never calling promote (no partial promotion)', async () => {
    mocks.callClaudeForRequirementMapping
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: 'still not json' });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.promoteOwnRequirementMappingRun).not.toHaveBeenCalled();
    expect(mocks.markOwnRequirementMappingRunFailed).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      RUN_ID,
      'validation_failed',
    );
  });

  it('returns provider_error immediately with no retry and marks the run FAILED', async () => {
    mocks.callClaudeForRequirementMapping.mockResolvedValueOnce({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.callClaudeForRequirementMapping).toHaveBeenCalledTimes(1);
    expect(mocks.promoteOwnRequirementMappingRun).not.toHaveBeenCalled();
    expect(mocks.markOwnRequirementMappingRunFailed).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      RUN_ID,
      'provider_error',
    );
  });

  it('treats a duplicate requirement fingerprint as a validation failure — the whole run is rejected, never partially promoted', async () => {
    const duplicateJson = JSON.stringify([
      {
        requirementText: '5+ years of backend experience',
        requirementCategory: 'EXPERIENCE',
        requiredOrPreferred: 'REQUIRED',
        relationship: 'DIRECT',
        matchedFactIds: [FACT_ID],
        explanation: 'First mention.',
        confidence: 0.9,
        requiresUserConfirmation: false,
      },
      {
        requirementText: '5+   years of backend experience', // same content, extra whitespace
        requirementCategory: 'EXPERIENCE',
        requiredOrPreferred: 'REQUIRED',
        relationship: 'DIRECT',
        matchedFactIds: [FACT_ID],
        explanation: 'Duplicate mention.',
        confidence: 0.9,
        requiresUserConfirmation: false,
      },
    ]);
    mocks.callClaudeForRequirementMapping.mockResolvedValueOnce({ status: 'ok', rawText: duplicateJson });

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result).toEqual({ status: 'validation_failed' });
    expect(mocks.promoteOwnRequirementMappingRun).not.toHaveBeenCalled();
    // Duplicate detection happens after contract validation already accepted the response (Zod
    // has no cross-item uniqueness rule) — so this is caught without a second Claude call, not
    // via the reject-and-retry path.
    expect(mocks.callClaudeForRequirementMapping).toHaveBeenCalledTimes(1);
  });
});

describe('generateRequirementMapping — usage telemetry', () => {
  it('records an ai_usage_events row with task_type requirement_mapping and never fails the request if telemetry recording throws', async () => {
    mocks.callClaudeForRequirementMapping.mockResolvedValueOnce({
      status: 'ok',
      rawText: validMappingJson(),
    });
    mocks.recordAiUsageEvent.mockRejectedValueOnce(new Error('telemetry insert failed'));

    const result = await generateRequirementMapping(FAKE_SUPABASE, USER_ID, PARAMS);

    expect(result.status).toBe('promoted');
    expect(mocks.recordAiUsageEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      USER_ID,
      expect.objectContaining({ taskType: 'requirement_mapping', fieldClassification: null }),
    );
  });
});
