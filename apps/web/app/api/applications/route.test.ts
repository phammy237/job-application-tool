import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnApplicationByJobId: vi.fn(),
  getOwnJob: vi.fn(),
  recordApplicationEvent: vi.fn(),
  recordOwnGeneratedAnswerDecision: vi.fn(),
  upsertApplicationWithSnapshot: vi.fn(),
  getUserIdFromExtensionToken: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnApplicationByJobId: mocks.getOwnApplicationByJobId,
  getOwnJob: mocks.getOwnJob,
  recordApplicationEvent: mocks.recordApplicationEvent,
  recordOwnGeneratedAnswerDecision: mocks.recordOwnGeneratedAnswerDecision,
  upsertApplicationWithSnapshot: mocks.upsertApplicationWithSnapshot,
}));

vi.mock('../../../lib/extension-auth', () => ({
  getUserIdFromExtensionToken: mocks.getUserIdFromExtensionToken,
}));

vi.mock('../../../lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

const { GET, POST, OPTIONS } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const GENERATED_ANSWER_ID = '55555555-5555-4555-8555-555555555555';

const OWN_JOB = {
  id: JOB_ID,
  userId: USER_ID,
  company: 'Acme',
  title: 'Backend Engineer',
  location: 'Remote',
  employmentType: 'Full-time',
  description: 'Build the payments service.',
  responsibilities: ['Own the payments pipeline'],
  qualifications: ['5+ years backend experience'],
  preferredQualifications: ['AWS experience'],
  skills: ['TypeScript'],
  sourceUrl: 'https://boards.example.com/job/123?utm_source=linkedin',
  platformType: 'GENERIC',
  rawExtraction: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_SAVE_BODY = {
  jobId: JOB_ID,
  status: 'IN_PROGRESS',
  autofillSummary: { approved: 2, filled: 2, skipped: 1, failed: 0, unresolved: 1, manual: 1 },
  unresolvedFields: [
    { label: 'Gender', classification: 'DEMOGRAPHIC', status: 'SENSITIVE', reason: 'Always requires your direct input.' },
  ],
  answeredFields: [{ generatedAnswerId: GENERATED_ANSWER_ID, decision: 'APPROVED', finalText: null }],
};

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/applications', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserIdFromExtensionToken.mockResolvedValue(USER_ID);
  mocks.createAdminClient.mockReturnValue({});
  mocks.getOwnJob.mockResolvedValue(OWN_JOB);
  mocks.upsertApplicationWithSnapshot.mockResolvedValue({
    applicationId: APPLICATION_ID,
    created: true,
    status: 'IN_PROGRESS',
    previousStatus: null,
    jobSnapshotId: 'snap-1',
    snapshotFrozen: false,
  });
});

describe('GET /api/applications', () => {
  it('returns 401 when there is no valid extension bearer token', async () => {
    mocks.getUserIdFromExtensionToken.mockResolvedValue(null);
    const response = await GET(new Request(`http://localhost/api/applications?jobId=${JOB_ID}`));
    expect(response.status).toBe(401);
    expect(mocks.getOwnApplicationByJobId).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or malformed jobId', async () => {
    const response = await GET(new Request('http://localhost/api/applications?jobId=not-a-uuid'));
    expect(response.status).toBe(400);
    expect(mocks.getOwnApplicationByJobId).not.toHaveBeenCalled();
  });

  it('returns application: null when no application is tracked for the job', async () => {
    mocks.getOwnApplicationByJobId.mockResolvedValue(null);
    const response = await GET(new Request(`http://localhost/api/applications?jobId=${JOB_ID}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ application: null });
  });

  it('returns the tracked application when one exists, scoped to the authenticated user', async () => {
    mocks.getOwnApplicationByJobId.mockResolvedValue({
      id: APPLICATION_ID,
      status: 'IN_PROGRESS',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const response = await GET(new Request(`http://localhost/api/applications?jobId=${JOB_ID}`));
    const body = await response.json();
    expect(body.application).toEqual({
      id: APPLICATION_ID,
      status: 'IN_PROGRESS',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mocks.getOwnApplicationByJobId).toHaveBeenCalledWith(expect.anything(), USER_ID, JOB_ID);
  });
});

describe('POST /api/applications', () => {
  it('returns 401 when there is no valid extension bearer token', async () => {
    mocks.getUserIdFromExtensionToken.mockResolvedValue(null);
    const response = await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(response.status).toBe(401);
    expect(mocks.upsertApplicationWithSnapshot).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed body', async () => {
    const response = await POST(jsonRequest('POST', { jobId: 'not-a-uuid' }));
    expect(response.status).toBe(400);
    expect(mocks.upsertApplicationWithSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a status other than SAVED/IN_PROGRESS at the schema level (APPLIED is a separate endpoint)', async () => {
    const response = await POST(jsonRequest('POST', { ...VALID_SAVE_BODY, status: 'APPLIED' }));
    expect(response.status).toBe(400);
    expect(mocks.upsertApplicationWithSnapshot).not.toHaveBeenCalled();
  });

  it('returns 404 when the job does not exist or is not owned by the caller', async () => {
    mocks.getOwnJob.mockResolvedValue(null);
    const response = await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(response.status).toBe(404);
    expect(mocks.upsertApplicationWithSnapshot).not.toHaveBeenCalled();
  });

  it('derives company/title/location/sourceUrl from the owned job row, never from the request body', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.upsertApplicationWithSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        location: 'Remote',
        sourceUrl: OWN_JOB.sourceUrl,
        snapshot: expect.objectContaining({ company: 'Acme', title: 'Backend Engineer' }),
      }),
    );
  });

  it('captures the full sanitized snapshot content (qualifications/responsibilities/skills), not just description', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.upsertApplicationWithSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        snapshot: expect.objectContaining({
          requiredQualifications: OWN_JOB.qualifications,
          preferredQualifications: OWN_JOB.preferredQualifications,
          responsibilities: OWN_JOB.responsibilities,
          skills: OWN_JOB.skills,
        }),
        snapshotContentFingerprint: expect.stringMatching(/^v1:[0-9a-f]{64}$/),
      }),
    );
  });

  it('canonicalizes the job source URL for the dedup match', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.upsertApplicationWithSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ canonicalUrl: 'https://boards.example.com/job/123' }),
    );
  });

  it('always passes externalId null — no current extractor populates a requisition id', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.upsertApplicationWithSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ externalId: null }),
    );
  });

  it('records a STATUS_CHANGE event for a newly created application', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.recordApplicationEvent).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ applicationId: APPLICATION_ID, fromStatus: null, toStatus: 'IN_PROGRESS' }),
    );
  });

  it('does not record a STATUS_CHANGE event on a repeat save that does not change status', async () => {
    mocks.upsertApplicationWithSnapshot.mockResolvedValue({
      applicationId: APPLICATION_ID,
      created: false,
      status: 'IN_PROGRESS',
      previousStatus: 'IN_PROGRESS',
    });
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
  });

  it('records a STATUS_CHANGE event when an update actually changes status', async () => {
    mocks.upsertApplicationWithSnapshot.mockResolvedValue({
      applicationId: APPLICATION_ID,
      created: false,
      status: 'IN_PROGRESS',
      previousStatus: 'SAVED',
    });
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.recordApplicationEvent).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ fromStatus: 'SAVED', toStatus: 'IN_PROGRESS' }),
    );
  });

  it('links each answered field to the saved application by reference, never re-sending answer content', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    expect(mocks.recordOwnGeneratedAnswerDecision).toHaveBeenCalledTimes(1);
    expect(mocks.recordOwnGeneratedAnswerDecision).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      GENERATED_ANSWER_ID,
      { applicationId: APPLICATION_ID, jobId: JOB_ID, decision: 'APPROVED', finalText: null },
    );
  });

  it('scopes the answer decision to the job being saved, not just the user — a cross-job reference must fail closed', async () => {
    await POST(jsonRequest('POST', VALID_SAVE_BODY));
    const call = mocks.recordOwnGeneratedAnswerDecision.mock.calls[0];
    expect(call?.[3]).toMatchObject({ jobId: JOB_ID });
  });

  it('passes finalText through only for an EDITED decision, never for APPROVED', async () => {
    await POST(
      jsonRequest('POST', {
        ...VALID_SAVE_BODY,
        answeredFields: [
          { generatedAnswerId: GENERATED_ANSWER_ID, decision: 'EDITED', finalText: 'My own wording' },
        ],
      }),
    );
    expect(mocks.recordOwnGeneratedAnswerDecision).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      GENERATED_ANSWER_ID,
      { applicationId: APPLICATION_ID, jobId: JOB_ID, decision: 'EDITED', finalText: 'My own wording' },
    );
  });

  it('reflects a chrome-extension:// origin in Access-Control-Allow-Origin', async () => {
    const response = await POST(jsonRequest('POST', VALID_SAVE_BODY, { origin: 'chrome-extension://abcdefg' }));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
  });

  it('does not set CORS headers for a non-extension origin', async () => {
    const response = await POST(jsonRequest('POST', VALID_SAVE_BODY, { origin: 'https://evil.example' }));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('OPTIONS returns 204 with CORS headers for a preflight from the extension', () => {
    const request = new Request('http://localhost/api/applications', {
      method: 'OPTIONS',
      headers: { origin: 'chrome-extension://abcdefg' },
    });
    const response = OPTIONS(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdefg');
  });
});
