import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Structurally identical stand-in for the real class in packages/database/src/queries/
 * resume-tailoring-save.ts — same name/shape so the route's `instanceof` check and `.reason`/
 * `.currentValue` reads behave exactly like the real thing. */
class MockSaveReviewedTailoredResumeError extends Error {
  constructor(
    public readonly reason:
      | 'application_not_found'
      | 'resume_not_found'
      | 'stale_base_resume'
      | 'stale_job_context',
    public readonly currentValue: string | null,
  ) {
    super(reason);
    this.name = 'SaveReviewedTailoredResumeError';
  }
}

const mocks = vi.hoisted(() => ({
  getOwnApplication: vi.fn(),
  getOwnProfile: vi.fn(),
  getOwnResume: vi.fn(),
  getOwnResumeVersion: vi.fn(),
  isOwnResumeWorkingForOtherApplication: vi.fn(),
  listOwnApprovedFactsForGeneration: vi.fn(),
  saveReviewedTailoredResume: vi.fn(),
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplication: mocks.getOwnApplication,
  getOwnProfile: mocks.getOwnProfile,
  getOwnResume: mocks.getOwnResume,
  getOwnResumeVersion: mocks.getOwnResumeVersion,
  isOwnResumeWorkingForOtherApplication: mocks.isOwnResumeWorkingForOtherApplication,
  listOwnApprovedFactsForGeneration: mocks.listOwnApprovedFactsForGeneration,
  saveReviewedTailoredResume: mocks.saveReviewedTailoredResume,
  SaveReviewedTailoredResumeError: MockSaveReviewedTailoredResumeError,
}));

vi.mock('../../../../../../lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('../../../../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('../../../../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const WORKING_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const JOB_SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const RESUME_ID = '77777777-7777-4777-8777-777777777777';
const FACT_ID = '88888888-8888-4888-8888-888888888888';
const PARAMS = { params: Promise.resolve({ id: APPLICATION_ID }) };

const HEADER = { fullName: 'Ada', email: null, phone: null, location: null, links: {} };

function baseStructuredResume(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    header: HEADER,
    education: [],
    experience: [
      {
        id: 'exp-1',
        organization: 'Acme',
        role: 'Engineer',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [
          {
            id: 'b1',
            text: 'Built the referral workflow',
            provenance: { type: 'MANUAL' },
          },
        ],
      },
    ],
    projects: [],
    leadership: [],
    skills: [],
    renderOverride: null,
    ...overrides,
  };
}

const REWRITE_OPERATION = {
  operationId: 'op-0',
  operation: {
    type: 'REWRITE_BULLET' as const,
    bulletId: 'b1',
    entryLabel: 'Engineer at Acme',
    before: 'Built the referral workflow',
    after: 'Led the referral workflow rebuild for 5 engineers',
    groundedFacts: [{ id: FACT_ID, label: 'Led a team of 5 engineers' }],
    relevantRequirements: [],
    reason: 'x',
  },
  decision: 'ACCEPTED' as const,
  edit: null,
};

function postRequest(body: unknown): Request {
  return new Request(
    `http://localhost/api/applications/${APPLICATION_ID}/resume-tailoring/save`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    baseResumeVersionId: WORKING_VERSION_ID,
    jobSnapshotId: JOB_SNAPSHOT_ID,
    operations: [REWRITE_OPERATION],
    acknowledgeCustomLatexOverrideReset: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue({});
  mocks.createClient.mockResolvedValue({});
  mocks.getOwnApplication.mockResolvedValue({
    id: APPLICATION_ID,
    company: 'Acme',
    title: 'Engineer',
    workingResumeVersionId: WORKING_VERSION_ID,
    jobSnapshotId: JOB_SNAPSHOT_ID,
  });
  mocks.getOwnResumeVersion.mockResolvedValue({
    id: WORKING_VERSION_ID,
    resumeId: RESUME_ID,
    versionNumber: 1,
    displayName: 'Master Resume',
    snapshotFormat: 'STRUCTURED_V1',
    snapshotPayload: baseStructuredResume(),
  });
  mocks.getOwnResume.mockResolvedValue({
    id: RESUME_ID,
    name: 'Master Resume',
    kind: 'MASTER',
    parentResumeId: null,
  });
  mocks.getOwnProfile.mockResolvedValue({ fullName: 'Ada Lovelace' });
  mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([
    {
      id: FACT_ID,
      sourceTable: 'candidate_facts',
      category: null,
      text: 'Led a team of 5 engineers',
      tags: [],
      recencyDate: null,
      isCurrent: false,
    },
  ]);
  mocks.isOwnResumeWorkingForOtherApplication.mockResolvedValue(false);
  mocks.saveReviewedTailoredResume.mockResolvedValue({
    resumeId: 'new-resume-id',
    resumeCreated: true,
    versionId: 'new-version-id',
    versionNumber: 1,
    displayName: "Ada Lovelace's Resume -- Acme -- Engineer",
  });
});

describe('POST /api/applications/[id]/resume-tailoring/save', () => {
  it('returns 401 without touching the database when there is no session', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(validBody()), PARAMS);
    expect(response.status).toBe(401);
    expect(mocks.getOwnApplication).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_request for malformed JSON', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: '{not json',
    });
    const response = await POST(request, PARAMS);
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe('invalid_request');
  });

  it('returns 400 invalid_request when the body fails schema validation', async () => {
    const response = await POST(postRequest({ nonsense: true }), PARAMS);
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe('invalid_request');
  });

  it('returns 404 when the application is not found or not owned', async () => {
    mocks.getOwnApplication.mockResolvedValue(null);
    const response = await POST(postRequest(validBody()), PARAMS);
    expect(response.status).toBe(404);
  });

  it("rejects as stale_base_resume when the application's working résumé has since changed", async () => {
    mocks.getOwnApplication.mockResolvedValue({
      id: APPLICATION_ID,
      company: 'Acme',
      title: 'Engineer',
      workingResumeVersionId: 'a-different-version-id',
      jobSnapshotId: JOB_SNAPSHOT_ID,
    });
    const response = await POST(postRequest(validBody()), PARAMS);
    const body = await response.json();
    expect(body).toEqual({
      status: 'stale_base_resume',
      currentWorkingResumeVersionId: 'a-different-version-id',
    });
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
  });

  it("rejects as stale_job_context when the application's job snapshot has since changed", async () => {
    mocks.getOwnApplication.mockResolvedValue({
      id: APPLICATION_ID,
      company: 'Acme',
      title: 'Engineer',
      workingResumeVersionId: WORKING_VERSION_ID,
      jobSnapshotId: 'a-different-snapshot-id',
    });
    const response = await POST(postRequest(validBody()), PARAMS);
    expect(await response.json()).toEqual({
      status: 'stale_job_context',
      currentJobSnapshotId: 'a-different-snapshot-id',
    });
  });

  it('returns unsupported_resume_format for a METADATA_ONLY base version', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue({
      id: WORKING_VERSION_ID,
      resumeId: RESUME_ID,
      versionNumber: 1,
      displayName: 'x',
      snapshotFormat: 'METADATA_ONLY',
      snapshotPayload: null,
    });
    const response = await POST(postRequest(validBody()), PARAMS);
    expect((await response.json()).status).toBe('unsupported_resume_format');
  });

  it('requires acknowledgement before saving when the base version has a custom LaTeX override', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue({
      id: WORKING_VERSION_ID,
      resumeId: RESUME_ID,
      versionNumber: 1,
      displayName: 'x',
      snapshotFormat: 'STRUCTURED_V1',
      snapshotPayload: baseStructuredResume({
        renderOverride: { latex: '\\documentclass{article}' },
      }),
    });
    const response = await POST(
      postRequest(validBody({ acknowledgeCustomLatexOverrideReset: false })),
      PARAMS,
    );
    expect((await response.json()).status).toBe('custom_latex_override_ack_required');
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
  });

  it('proceeds once the custom LaTeX override reset is acknowledged', async () => {
    mocks.getOwnResumeVersion.mockResolvedValue({
      id: WORKING_VERSION_ID,
      resumeId: RESUME_ID,
      versionNumber: 1,
      displayName: 'x',
      snapshotFormat: 'STRUCTURED_V1',
      snapshotPayload: baseStructuredResume({
        renderOverride: { latex: '\\documentclass{article}' },
      }),
    });
    const response = await POST(
      postRequest(validBody({ acknowledgeCustomLatexOverrideReset: true })),
      PARAMS,
    );
    expect((await response.json()).status).toBe('ok');
    // The saved payload never carries the override forward.
    expect(mocks.saveReviewedTailoredResume).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        snapshotPayload: expect.objectContaining({ renderOverride: null }),
      }),
    );
  });

  it('returns unresolved_operations when any operation is left PENDING', async () => {
    const response = await POST(
      postRequest(
        validBody({ operations: [{ ...REWRITE_OPERATION, decision: 'PENDING' }] }),
      ),
      PARAMS,
    );
    expect((await response.json()).status).toBe('unresolved_operations');
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
  });

  it('returns no_changes when every operation is rejected', async () => {
    const response = await POST(
      postRequest(
        validBody({ operations: [{ ...REWRITE_OPERATION, decision: 'REJECTED' }] }),
      ),
      PARAMS,
    );
    expect((await response.json()).status).toBe('no_changes');
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
  });

  it('rejects with validation_failed when a cited fact id is not in the fresh approved set (cross-user/revoked)', async () => {
    mocks.listOwnApprovedFactsForGeneration.mockResolvedValue([]); // FACT_ID no longer approved
    const response = await POST(postRequest(validBody()), PARAMS);
    const body = await response.json();
    expect(body.status).toBe('validation_failed');
    expect(body.reason).toBe('unknown_fact_id');
    expect(mocks.saveReviewedTailoredResume).not.toHaveBeenCalled();
  });

  it('rejects a MANUAL edit that is fine content-wise, and accepts it (never grounding-checked)', async () => {
    const response = await POST(
      postRequest(
        validBody({
          operations: [
            {
              ...REWRITE_OPERATION,
              edit: { text: 'Grew revenue by $50M', provenanceChoice: 'MANUAL' },
            },
          ],
        }),
      ),
      PARAMS,
    );
    expect((await response.json()).status).toBe('ok');
  });

  it('rejects a KEEP_GROUNDED edit introducing an unsupported number', async () => {
    const response = await POST(
      postRequest(
        validBody({
          operations: [
            {
              ...REWRITE_OPERATION,
              edit: { text: 'Grew revenue by $50M', provenanceChoice: 'KEEP_GROUNDED' },
            },
          ],
        }),
      ),
      PARAMS,
    );
    const body = await response.json();
    expect(body.status).toBe('validation_failed');
    expect(body.reason).toBe('ungrounded_number');
  });

  it('MASTER base: creates a new TAILORED résumé, parented at the master', async () => {
    const response = await POST(postRequest(validBody()), PARAMS);
    expect((await response.json()).status).toBe('ok');
    expect(mocks.saveReviewedTailoredResume).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        targetResumeId: null,
        newResumeName: "Ada Lovelace's Resume -- Acme -- Engineer",
        newResumeParentId: RESUME_ID,
      }),
    );
  });

  it('TAILORED base, sole user of it: appends the next version to the same logical résumé', async () => {
    mocks.getOwnResume.mockResolvedValue({
      id: RESUME_ID,
      name: 'Tailored',
      kind: 'TAILORED',
      parentResumeId: 'master-id',
    });
    mocks.isOwnResumeWorkingForOtherApplication.mockResolvedValue(false);
    const response = await POST(postRequest(validBody()), PARAMS);
    expect((await response.json()).status).toBe('ok');
    expect(mocks.saveReviewedTailoredResume).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        targetResumeId: RESUME_ID,
        newResumeName: null,
        newResumeParentId: null,
      }),
    );
  });

  it('TAILORED base shared with another application: clones into a new TAILORED résumé instead of mutating the shared one', async () => {
    mocks.getOwnResume.mockResolvedValue({
      id: RESUME_ID,
      name: 'Tailored',
      kind: 'TAILORED',
      parentResumeId: 'master-id',
    });
    mocks.isOwnResumeWorkingForOtherApplication.mockResolvedValue(true);
    const response = await POST(postRequest(validBody()), PARAMS);
    expect((await response.json()).status).toBe('ok');
    expect(mocks.saveReviewedTailoredResume).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        targetResumeId: null,
        newResumeName: "Ada Lovelace's Resume -- Acme -- Engineer",
        newResumeParentId: 'master-id',
      }),
    );
  });

  it('maps a concurrent stale_base_resume rejection from the RPC itself (the real race-safety guarantee)', async () => {
    mocks.saveReviewedTailoredResume.mockRejectedValue(
      new MockSaveReviewedTailoredResumeError(
        'stale_base_resume',
        'someone-elses-new-version',
      ),
    );
    const response = await POST(postRequest(validBody()), PARAMS);
    expect(await response.json()).toEqual({
      status: 'stale_base_resume',
      currentWorkingResumeVersionId: 'someone-elses-new-version',
    });
  });

  it('never calls the database at all for an invalid request body', async () => {
    await POST(postRequest({ nonsense: true }), PARAMS);
    expect(mocks.getOwnApplication).not.toHaveBeenCalled();
  });
});
