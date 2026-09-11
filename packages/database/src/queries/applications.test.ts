import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SanitizedJobSnapshotContent } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';

// markOwnApplicationApplied (Phase 5B.1) now orchestrates three sibling modules instead of doing
// a raw table update itself — mocked at module scope so its own tests can assert exactly what it
// asks each dependency to do, without re-testing those dependencies' own already-covered
// internals (listOwnGeneratedAnswersForApplication, getCurrentOwnRequirementMappingRun, and the
// mark_application_applied RPC wrapper each have their own test coverage elsewhere).
const mocks = vi.hoisted(() => ({
  listOwnGeneratedAnswersForApplication: vi.fn(),
  getCurrentOwnRequirementMappingRun: vi.fn(),
  markApplicationAppliedAtomic: vi.fn(),
  evaluateOwnConsistencyFindingsForAnswers: vi.fn(),
}));

vi.mock('./generated-answers', () => ({
  listOwnGeneratedAnswersForApplication: mocks.listOwnGeneratedAnswersForApplication,
}));
vi.mock('./requirement-mapping-runs', () => ({
  getCurrentOwnRequirementMappingRun: mocks.getCurrentOwnRequirementMappingRun,
}));
vi.mock('./submission-packets', () => ({
  markApplicationAppliedAtomic: mocks.markApplicationAppliedAtomic,
}));
// Only the trusted-input assembly is mocked (controls which findings come back); the real,
// pure enforceConsistencyGate is exercised as-is, so these orchestration tests also prove the
// real gate logic actually runs — not just that something claiming to be it was called.
vi.mock('./consistency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./consistency')>();
  return {
    ...actual,
    evaluateOwnConsistencyFindingsForAnswers:
      mocks.evaluateOwnConsistencyFindingsForAnswers,
  };
});

const {
  changeOwnApplicationStatus,
  createOwnApplication,
  getOwnApplicationByJobId,
  markOwnApplicationApplied,
  upsertApplicationFromExtension,
  upsertApplicationWithSnapshot,
} = await import('./applications');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

const BASE_ROW = {
  id: APPLICATION_ID,
  user_id: USER_ID,
  job_id: JOB_ID,
  resume_id: null,
  company: 'Acme',
  title: 'Backend Engineer',
  status: 'IN_PROGRESS',
  notes: null,
  applied_at: null,
  location: 'Remote',
  source_url: 'https://boards.example.com/job/123',
  canonical_url: 'https://boards.example.com/job/123',
  ats_provider: 'GENERIC',
  external_id: null,
  autofill_summary: null,
  unresolved_fields: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('getOwnApplicationByJobId', () => {
  it('scopes the query by both user_id and job_id', async () => {
    const eq = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = eq.mockImplementation(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnApplicationByJobId(supabase, USER_ID, JOB_ID);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('job_id', JOB_ID);
    expect(result?.id).toBe(APPLICATION_ID);
  });

  it('returns null when no application is tracked for the job', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnApplicationByJobId(supabase, USER_ID, JOB_ID);
    expect(result).toBeNull();
  });
});

describe('rowToApplication migration-observability warning (via getOwnApplicationByJobId)', () => {
  function chainReturning(row: unknown) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    return { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
  }

  it('warns exactly once when a row is missing the migration 0008/0009 columns, and never crashes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A row shaped like one read from a database that never had migrations 0008/0009 applied
      // — the keys are absent entirely, not present-and-null.
      const {
        source_url: _sourceUrl,
        location: _location,
        ...rowMissingMigrationColumns
      } = BASE_ROW;

      const first = await getOwnApplicationByJobId(
        chainReturning(rowMissingMigrationColumns),
        USER_ID,
        JOB_ID,
      );
      expect(first?.sourceUrl).toBeNull();
      expect(first?.location).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('migration 0008/0009');

      // A second row shaped the same way must not warn again (once per process, not once per row).
      await getOwnApplicationByJobId(
        chainReturning(rowMissingMigrationColumns),
        USER_ID,
        JOB_ID,
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // A normally-shaped row (migration present) must not trigger any further warning either.
      await getOwnApplicationByJobId(chainReturning(BASE_ROW), USER_ID, JOB_ID);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('upsertApplicationFromExtension', () => {
  it('calls the upsert_application_from_extension RPC with the authenticated user id, not any client-supplied id', async () => {
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          application_id: APPLICATION_ID,
          created: true,
          final_status: 'SAVED',
          previous_status: null,
        },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationFromExtension(supabase, USER_ID, {
      jobId: JOB_ID,
      company: 'Acme',
      title: 'Backend Engineer',
      location: null,
      status: 'SAVED',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: {
        approved: 0,
        filled: 0,
        skipped: 0,
        failed: 0,
        unresolved: 0,
        manual: 0,
      },
      unresolvedFields: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      'upsert_application_from_extension',
      expect.objectContaining({ p_user_id: USER_ID, p_job_id: JOB_ID }),
    );
    expect(result).toEqual({
      applicationId: APPLICATION_ID,
      created: true,
      status: 'SAVED',
      previousStatus: null,
    });
  });
});

const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

const BASE_SNAPSHOT_CONTENT: SanitizedJobSnapshotContent = {
  company: 'Acme',
  title: 'Backend Engineer',
  location: 'Remote',
  employmentType: 'Full-time',
  sourceUrl: 'https://boards.example.com/job/123',
  externalId: null,
  description: 'Build things.',
  requiredQualifications: ['5 years of Python'],
  preferredQualifications: [],
  responsibilities: [],
  skills: ['Python'],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  locations: ['Remote'],
  workMode: 'REMOTE',
  remoteLocationRestrictions: null,
  workAuthorizationLanguage: null,
  sourceType: 'GENERIC',
};

describe('upsertApplicationWithSnapshot', () => {
  it('calls the server-only upsert_application_with_snapshot RPC with the authenticated user id and links the snapshot when SAVED/IN_PROGRESS', async () => {
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          application_id: APPLICATION_ID,
          created: true,
          final_status: 'SAVED',
          previous_status: null,
          job_snapshot_id: SNAPSHOT_ID,
          snapshot_frozen: false,
        },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationWithSnapshot(supabase, USER_ID, {
      jobId: JOB_ID,
      status: 'SAVED',
      snapshot: BASE_SNAPSHOT_CONTENT,
      snapshotContentFingerprint: 'v1:abc123',
      snapshotContentTruncated: false,
      snapshotTruncatedFields: [],
      location: 'Remote',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: {
        approved: 0,
        filled: 0,
        skipped: 0,
        failed: 0,
        unresolved: 0,
        manual: 0,
      },
      unresolvedFields: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      'upsert_application_with_snapshot',
      expect.objectContaining({
        p_user_id: USER_ID,
        p_job_id: JOB_ID,
        p_snapshot_content_fingerprint: 'v1:abc123',
      }),
    );
    expect(result).toEqual({
      applicationId: APPLICATION_ID,
      created: true,
      status: 'SAVED',
      previousStatus: null,
      jobSnapshotId: SNAPSHOT_ID,
      snapshotFrozen: false,
    });
  });

  it('surfaces snapshotFrozen=true and the preserved (unchanged) jobSnapshotId when the application is already APPLIED', async () => {
    const EXISTING_SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999';
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          application_id: APPLICATION_ID,
          created: false,
          final_status: 'APPLIED',
          previous_status: 'APPLIED',
          job_snapshot_id: EXISTING_SNAPSHOT_ID,
          snapshot_frozen: true,
        },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationWithSnapshot(supabase, USER_ID, {
      jobId: JOB_ID,
      status: 'SAVED',
      snapshot: {
        ...BASE_SNAPSHOT_CONTENT,
        description: 'Re-analyzed, different content now.',
      },
      snapshotContentFingerprint: 'v1:different',
      snapshotContentTruncated: false,
      snapshotTruncatedFields: [],
      location: 'Remote',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: {
        approved: 0,
        filled: 0,
        skipped: 0,
        failed: 0,
        unresolved: 0,
        manual: 0,
      },
      unresolvedFields: [],
    });

    expect(result.snapshotFrozen).toBe(true);
    expect(result.jobSnapshotId).toBe(EXISTING_SNAPSHOT_ID);
  });
});

/**
 * Shared mock for the two-or-three-call sequence markOwnApplicationApplied/
 * changeOwnApplicationStatus/createOwnApplication each make: a read via getOwnApplication (when
 * applicable), an update/insert on `applications`, and — conditionally — an insert on
 * `application_events`. One chain object per table; each chain method returns itself except the
 * two terminal reads, which resolve independently so both a `select().maybeSingle()` read and a
 * `select().single()` write can share the same mocked `.eq`/`.select`, matching this file's
 * existing chain-mock style.
 */
function mockApplicationsAndEvents(options: {
  currentRow: Record<string, unknown> | null;
  updatedRow?: Record<string, unknown>;
  eventRow?: Record<string, unknown>;
}) {
  const appChain: Record<string, unknown> = {};
  appChain.select = vi.fn(() => appChain);
  appChain.insert = vi.fn(() => appChain);
  appChain.update = vi.fn(() => appChain);
  appChain.eq = vi.fn(() => appChain);
  appChain.maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: options.currentRow, error: null });
  appChain.single = vi
    .fn()
    .mockResolvedValue({ data: options.updatedRow ?? options.currentRow, error: null });

  const eventChain: Record<string, unknown> = {};
  eventChain.insert = vi.fn(() => eventChain);
  eventChain.select = vi.fn(() => eventChain);
  eventChain.single = vi.fn().mockResolvedValue({
    data: options.eventRow ?? {
      id: '66666666-6666-4666-8666-666666666666',
      user_id: USER_ID,
      application_id: APPLICATION_ID,
      event_type: 'STATUS_CHANGE',
      from_status: null,
      to_status: null,
      source: 'USER',
      email_signal_id: null,
      reverted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    error: null,
  });

  const from = vi.fn((table: string) =>
    table === 'applications' ? appChain : eventChain,
  );
  const supabase = { from } as unknown as CareerOsSupabaseClient;
  return { supabase, from, appChain, eventChain };
}

describe('markOwnApplicationApplied', () => {
  beforeEach(() => {
    mocks.listOwnGeneratedAnswersForApplication.mockReset();
    mocks.getCurrentOwnRequirementMappingRun.mockReset();
    mocks.markApplicationAppliedAtomic.mockReset();
    mocks.evaluateOwnConsistencyFindingsForAnswers.mockReset().mockResolvedValue([]);
  });

  /** getOwnApplication is called twice on a real transition (before, to read current state; and
   * after, to return the authoritative final row) and once on the idempotent/not-found paths —
   * each call resolved independently, in order, matching real Supabase client sequencing. */
  function mockApplicationReads(rows: (Record<string, unknown> | null)[]) {
    const appChain: Record<string, unknown> = {};
    appChain.select = vi.fn(() => appChain);
    appChain.eq = vi.fn(() => appChain);
    const maybeSingle = vi.fn();
    for (const row of rows) maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    appChain.maybeSingle = maybeSingle;
    const from = vi.fn(() => appChain);
    return { supabase: { from } as unknown as CareerOsSupabaseClient, from };
  }

  const GENERATED_ANSWER = {
    id: '77777777-7777-4777-8777-777777777777',
    userId: USER_ID,
    applicationId: APPLICATION_ID,
    jobId: JOB_ID,
    fieldLabel: 'Why us?',
    fieldClassification: 'FREE_RESPONSE' as const,
    answer: 'Original draft.',
    confidence: 0.9,
    sourceFactIds: ['88888888-8888-4888-8888-888888888888'],
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

  it('on a first transition: gathers generated answers, resolves the current requirement run, calls the atomic RPC, and returns the final application', async () => {
    const SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999';
    const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const PACKET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const { supabase, from } = mockApplicationReads([
      {
        ...BASE_ROW,
        status: 'IN_PROGRESS',
        applied_at: null,
        job_snapshot_id: SNAPSHOT_ID,
      },
      {
        ...BASE_ROW,
        status: 'APPLIED',
        applied_at: '2026-06-01T00:00:00.000Z',
        job_snapshot_id: SNAPSHOT_ID,
        submission_packet_id: PACKET_ID,
      },
    ]);
    mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([GENERATED_ANSWER]);
    mocks.getCurrentOwnRequirementMappingRun.mockResolvedValue({
      id: RUN_ID,
      userId: USER_ID,
      jobSnapshotId: SNAPSHOT_ID,
      status: 'CURRENT',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptVersion: 'v1',
      retrievalFactCount: 3,
      failureCategory: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      failedAt: null,
    });
    mocks.markApplicationAppliedAtomic.mockResolvedValue({
      applicationId: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-06-01T00:00:00.000Z',
      previousStatus: 'IN_PROGRESS',
      submissionPacketId: PACKET_ID,
      packetCreated: true,
    });

    const result = await markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID);

    expect(mocks.listOwnGeneratedAnswersForApplication).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      APPLICATION_ID,
    );
    expect(mocks.getCurrentOwnRequirementMappingRun).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      SNAPSHOT_ID,
    );
    expect(mocks.markApplicationAppliedAtomic).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      APPLICATION_ID,
      expect.objectContaining({
        answersSnapshot: [
          expect.objectContaining({
            generatedAnswerId: GENERATED_ANSWER.id,
            fieldLabel: 'Why us?',
            originalAnswer: 'Original draft.',
            userDecision: 'APPROVED',
            sourceFactIds: GENERATED_ANSWER.sourceFactIds,
          }),
        ],
        jobSnapshotId: SNAPSHOT_ID,
        requirementMappingRunId: RUN_ID,
        contentFingerprint: expect.stringMatching(/^v1:/),
      }),
    );
    expect(result.status).toBe('APPLIED');
    expect(result.submissionPacketId).toBe(PACKET_ID);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('is idempotent when already APPLIED: never assembles packet content, calls the RPC with an empty payload, and returns current state without a second read', async () => {
    const { supabase, from } = mockApplicationReads([
      { ...BASE_ROW, status: 'APPLIED', applied_at: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.markApplicationAppliedAtomic.mockResolvedValue({
      applicationId: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-01-01T00:00:00.000Z',
      previousStatus: 'APPLIED',
      submissionPacketId: null,
      packetCreated: false,
    });

    const result = await markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID);

    expect(mocks.listOwnGeneratedAnswersForApplication).not.toHaveBeenCalled();
    expect(mocks.getCurrentOwnRequirementMappingRun).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      APPLICATION_ID,
      expect.objectContaining({
        answersSnapshot: [],
        jobSnapshotId: null,
        resumeId: null,
      }),
    );
    expect(result.appliedAt).toBe('2026-01-01T00:00:00.000Z');
    // Only the one initial read — no second getOwnApplication call, since nothing changed.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('does not resolve a requirement run when the application has no job snapshot', async () => {
    const { supabase } = mockApplicationReads([
      { ...BASE_ROW, status: 'IN_PROGRESS', applied_at: null, job_snapshot_id: null },
      {
        ...BASE_ROW,
        status: 'APPLIED',
        applied_at: '2026-06-01T00:00:00.000Z',
        job_snapshot_id: null,
      },
    ]);
    mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([]);
    mocks.markApplicationAppliedAtomic.mockResolvedValue({
      applicationId: APPLICATION_ID,
      status: 'APPLIED',
      appliedAt: '2026-06-01T00:00:00.000Z',
      previousStatus: 'IN_PROGRESS',
      submissionPacketId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      packetCreated: true,
    });

    await markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID);

    expect(mocks.getCurrentOwnRequirementMappingRun).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      APPLICATION_ID,
      expect.objectContaining({ jobSnapshotId: null, requirementMappingRunId: null }),
    );
  });

  it('throws without calling any dependency when the application is not found or not owned', async () => {
    const { supabase } = mockApplicationReads([null]);

    await expect(
      markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID),
    ).rejects.toThrow(/not found or not owned/);
    expect(mocks.listOwnGeneratedAnswersForApplication).not.toHaveBeenCalled();
    expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
  });

  describe('the consistency gate (Phase 5B.2)', () => {
    const BLOCKING_FINDING = {
      id: 'blocking-1',
      ruleId: 'ELIGIBILITY_SELF_CONTRADICTION' as const,
      severity: 'BLOCKING' as const,
      fieldALabel: 'A',
      fieldASource: 'GENERATED_ANSWER' as const,
      fieldAValue: 'Yes',
      fieldBLabel: 'B',
      fieldBSource: 'GENERATED_ANSWER' as const,
      fieldBValue: 'No',
      description: 'Contradiction',
    };
    const WARNING_FINDING = {
      id: 'warning-1',
      ruleId: 'GPA_MISMATCH' as const,
      severity: 'WARNING' as const,
      fieldALabel: 'GPA',
      fieldASource: 'GENERATED_ANSWER' as const,
      fieldAValue: '3.2',
      fieldBLabel: 'GPA',
      fieldBSource: 'PROFILE_EDUCATION' as const,
      fieldBValue: '3.9',
      description: 'Mismatch',
    };

    it('rejects a real transition when a BLOCKING finding exists, even if its id is passed as an acknowledgement', async () => {
      const { supabase } = mockApplicationReads([{ ...BASE_ROW, status: 'IN_PROGRESS' }]);
      mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([]);
      mocks.evaluateOwnConsistencyFindingsForAnswers.mockResolvedValue([
        BLOCKING_FINDING,
      ]);

      await expect(
        markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID, {
          acknowledgedFindingIds: [BLOCKING_FINDING.id],
        }),
      ).rejects.toMatchObject({
        name: 'ConsistencyCheckFailedError',
        reason: 'blocking_findings',
      });
      expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    });

    it('rejects a real transition when a WARNING finding is not acknowledged', async () => {
      const { supabase } = mockApplicationReads([{ ...BASE_ROW, status: 'IN_PROGRESS' }]);
      mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([]);
      mocks.evaluateOwnConsistencyFindingsForAnswers.mockResolvedValue([WARNING_FINDING]);

      await expect(
        markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID),
      ).rejects.toMatchObject({
        name: 'ConsistencyCheckFailedError',
        reason: 'unacknowledged_warnings',
      });
      expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    });

    it('a stale or invented acknowledgement id does not satisfy a real current warning', async () => {
      const { supabase } = mockApplicationReads([{ ...BASE_ROW, status: 'IN_PROGRESS' }]);
      mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([]);
      mocks.evaluateOwnConsistencyFindingsForAnswers.mockResolvedValue([WARNING_FINDING]);

      await expect(
        markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID, {
          acknowledgedFindingIds: ['some-other-stale-or-invented-id'],
        }),
      ).rejects.toMatchObject({ reason: 'unacknowledged_warnings' });
      expect(mocks.markApplicationAppliedAtomic).not.toHaveBeenCalled();
    });

    it('succeeds and freezes an acknowledgement record when the WARNING finding is acknowledged by its real id', async () => {
      const { supabase } = mockApplicationReads([
        { ...BASE_ROW, status: 'IN_PROGRESS' },
        { ...BASE_ROW, status: 'APPLIED' },
      ]);
      mocks.listOwnGeneratedAnswersForApplication.mockResolvedValue([]);
      mocks.evaluateOwnConsistencyFindingsForAnswers.mockResolvedValue([WARNING_FINDING]);
      mocks.markApplicationAppliedAtomic.mockResolvedValue({
        applicationId: APPLICATION_ID,
        status: 'APPLIED',
        appliedAt: '2026-06-01T00:00:00.000Z',
        previousStatus: 'IN_PROGRESS',
        submissionPacketId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        packetCreated: true,
      });

      await markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID, {
        acknowledgedFindingIds: [WARNING_FINDING.id],
      });

      expect(mocks.markApplicationAppliedAtomic).toHaveBeenCalledWith(
        supabase,
        USER_ID,
        APPLICATION_ID,
        expect.objectContaining({
          consistencyFindings: [WARNING_FINDING],
          consistencyAcknowledgements: [
            expect.objectContaining({ findingId: WARNING_FINDING.id }),
          ],
        }),
      );
    });

    it('never runs the gate on the idempotent already-APPLIED path', async () => {
      const { supabase } = mockApplicationReads([{ ...BASE_ROW, status: 'APPLIED' }]);
      mocks.markApplicationAppliedAtomic.mockResolvedValue({
        applicationId: APPLICATION_ID,
        status: 'APPLIED',
        appliedAt: '2026-01-01T00:00:00.000Z',
        previousStatus: 'APPLIED',
        submissionPacketId: null,
        packetCreated: false,
      });

      await markOwnApplicationApplied(supabase, USER_ID, APPLICATION_ID);

      expect(mocks.evaluateOwnConsistencyFindingsForAnswers).not.toHaveBeenCalled();
    });
  });
});

describe('changeOwnApplicationStatus', () => {
  it('refuses APPLIED without touching the database at all — the dashboard must route APPLIED through markOwnApplicationApplied instead', async () => {
    const { supabase, from } = mockApplicationsAndEvents({
      currentRow: { ...BASE_ROW, status: 'IN_PROGRESS' },
    });

    await expect(
      changeOwnApplicationStatus(supabase, USER_ID, APPLICATION_ID, 'APPLIED'),
    ).rejects.toThrow(/markOwnApplicationApplied/);
    expect(from).not.toHaveBeenCalled();
  });

  it('still handles every other status normally', async () => {
    const { supabase, appChain, eventChain } = mockApplicationsAndEvents({
      currentRow: { ...BASE_ROW, status: 'SAVED' },
      updatedRow: { ...BASE_ROW, status: 'IN_PROGRESS' },
    });

    const result = await changeOwnApplicationStatus(
      supabase,
      USER_ID,
      APPLICATION_ID,
      'IN_PROGRESS',
    );

    expect(result.status).toBe('IN_PROGRESS');
    expect(appChain.update).toHaveBeenCalledWith({ status: 'IN_PROGRESS' });
    expect(eventChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        from_status: 'SAVED',
        to_status: 'IN_PROGRESS',
        source: 'USER',
      }),
    );
  });
});

describe('createOwnApplication', () => {
  it('defaults to status SAVED with a null applied_at when no status is given', async () => {
    const { supabase, appChain } = mockApplicationsAndEvents({
      currentRow: null,
      updatedRow: { ...BASE_ROW, status: 'SAVED', applied_at: null },
    });

    await createOwnApplication(supabase, USER_ID, {
      company: 'Acme',
      title: 'Engineer',
      status: 'SAVED',
    });

    expect(appChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SAVED', applied_at: null }),
    );
  });

  it('creates with status IN_PROGRESS and a null applied_at', async () => {
    const { supabase, appChain } = mockApplicationsAndEvents({
      currentRow: null,
      updatedRow: { ...BASE_ROW, status: 'IN_PROGRESS', applied_at: null },
    });

    await createOwnApplication(supabase, USER_ID, {
      company: 'Acme',
      title: 'Engineer',
      status: 'IN_PROGRESS',
    });

    expect(appChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'IN_PROGRESS', applied_at: null }),
    );
  });

  it('rejects status APPLIED at runtime — defense-in-depth beneath the type-level guarantee, for a caller that bypasses ApplicationInput entirely (docs/IMPLEMENTATION_PLAN.md Phase 5B.0)', async () => {
    const { supabase, appChain, eventChain, from } = mockApplicationsAndEvents({
      currentRow: null,
    });

    // Simulates a caller that reaches this function without going through
    // applicationInputSchema.parse(...) or staying correctly typed — the only way 'APPLIED' could
    // arrive here at all, since ApplicationInput's own type already excludes it.
    const bypassedInput = {
      company: 'Acme',
      title: 'Engineer',
      status: 'APPLIED',
    } as unknown as Parameters<typeof createOwnApplication>[2];

    await expect(createOwnApplication(supabase, USER_ID, bypassedInput)).rejects.toThrow(
      /markOwnApplicationApplied/,
    );
    expect(from).not.toHaveBeenCalled();
    expect(appChain.insert).not.toHaveBeenCalled();
    expect(eventChain.insert).not.toHaveBeenCalled();
  });
});
