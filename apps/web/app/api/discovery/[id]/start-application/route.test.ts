import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getJobCatalogEntryById: vi.fn(),
  getJobCatalogFeatures: vi.fn(),
  getJobSource: vi.fn(),
  getOwnMatchScore: vi.fn(),
  startApplicationFromCatalogJob: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getJobCatalogEntryById: mocks.getJobCatalogEntryById,
  getJobCatalogFeatures: mocks.getJobCatalogFeatures,
  getJobSource: mocks.getJobSource,
  getOwnMatchScore: mocks.getOwnMatchScore,
  startApplicationFromCatalogJob: mocks.startApplicationFromCatalogJob,
}));
vi.mock('../../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../../lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_CATALOG_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_CLIENT = { tag: 'session-scoped' };
const ADMIN_CLIENT = { tag: 'admin' };

const BASE_JOB = {
  id: JOB_CATALOG_ID,
  sourceId: '44444444-4444-4444-8444-444444444444',
  sourceJobId: 'ext-1',
  companyName: 'Acme',
  title: 'Software Engineer',
  normalizedTitle: 'software engineer',
  locationText: 'Remote',
  normalizedLocation: 'remote',
  city: null,
  stateRegion: null,
  country: null,
  workplaceType: 'REMOTE',
  employmentType: 'Full-time',
  description: 'Build things.',
  responsibilities: 'Ship features.',
  qualifications: '5 years experience.',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  applyUrl: 'https://acme.example.com/apply/1',
  sourceUrl: 'https://acme.example.com/jobs/1',
  canonicalApplyUrl: 'https://acme.example.com/apply/1',
  dedupeFingerprint: 'fp',
  postedAt: null,
  sourceUpdatedAt: null,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  contentUpdatedAt: '2026-01-01T00:00:00.000Z',
  consecutiveMisses: 0,
  status: 'ACTIVE',
  closedAt: null,
  contentHash: 'hash',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_FEATURES = {
  id: 'feat-1',
  jobCatalogId: JOB_CATALOG_ID,
  contentHashAtExtraction: 'hash',
  plainTextDescription: 'Build things.',
  roleFamily: 'SOFTWARE_ENGINEERING',
  seniority: 'MID',
  isInternship: false,
  isNewGrad: false,
  normalizedEmploymentType: 'FULL_TIME',
  normalizedWorkplaceType: 'REMOTE',
  locationTokens: [],
  extractedCompetencyCodes: [],
  requiredYearsMin: null,
  requiredYearsMax: null,
  graduationYearMin: null,
  graduationYearMax: null,
  sponsorshipSignal: 'UNKNOWN',
  citizenshipRequirement: 'UNKNOWN',
  clearanceRequirement: 'UNKNOWN',
  workAuthorizationRequirement: 'UNKNOWN',
  evidence: {},
  featureVersion: 'd4-features-v1',
  computedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_JOB_SOURCE = {
  id: BASE_JOB.sourceId,
  companyName: 'Acme',
  sourceType: 'GREENHOUSE',
  sourceIdentifier: 'acme',
  careersUrl: null,
  enabled: true,
  crawlIntervalHours: 24,
  lastCrawledAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_MATCH_SCORE = {
  id: 'score-1',
  userId: USER_ID,
  jobCatalogId: JOB_CATALOG_ID,
  matchScore: 78,
  coverage: 65,
  eligibilityStatus: 'ELIGIBLE',
  scoreComponents: [],
  eligibilityChecks: [],
  rankingVersion: 'd4-ranking-v1',
  featureVersion: 'd4-features-v1',
  eligibilityVersion: 'd4-eligibility-v1',
  computedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function postRequest(): Request {
  return new Request(`http://localhost/api/discovery/${JOB_CATALOG_ID}/start-application`, {
    method: 'POST',
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.createAdminClient.mockReturnValue(ADMIN_CLIENT);
  mocks.getJobCatalogEntryById.mockResolvedValue(BASE_JOB);
  mocks.getJobCatalogFeatures.mockResolvedValue(BASE_FEATURES);
  mocks.getJobSource.mockResolvedValue(BASE_JOB_SOURCE);
  mocks.getOwnMatchScore.mockResolvedValue(BASE_MATCH_SCORE);
  mocks.startApplicationFromCatalogJob.mockResolvedValue({
    applicationId: 'app-1',
    created: true,
    status: 'SAVED',
    jobSnapshotId: 'snap-1',
  });
});

describe('POST /api/discovery/[id]/start-application', () => {
  it('returns 401 when there is no authenticated session, and touches nothing', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(response.status).toBe(401);
    expect(mocks.startApplicationFromCatalogJob).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed (non-uuid) job id, and touches nothing', async () => {
    const response = await POST(postRequest(), paramsFor('not-a-uuid'));
    expect(response.status).toBe(400);
    expect(mocks.getJobCatalogEntryById).not.toHaveBeenCalled();
    expect(mocks.startApplicationFromCatalogJob).not.toHaveBeenCalled();
  });

  it('returns 404 when the catalog job does not exist', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue(null);
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(response.status).toBe(404);
    expect(mocks.startApplicationFromCatalogJob).not.toHaveBeenCalled();
  });

  it('creates the application and returns its id, created flag, and status', async () => {
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ applicationId: 'app-1', created: true, status: 'SAVED' });
  });

  it('never requests a status other than SAVED — no status parameter is ever sent to the RPC wrapper', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input).not.toHaveProperty('status');
  });

  it('derives userId only from the verified session and uses the admin client only for the write step', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(mocks.getJobCatalogEntryById).toHaveBeenCalledWith(SESSION_CLIENT, JOB_CATALOG_ID);
    expect(mocks.getOwnMatchScore).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, JOB_CATALOG_ID);
    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      USER_ID,
      expect.anything(),
    );
  });

  it('reads job_sources via the admin client, never the session client — job_sources has no authenticated SELECT policy at all (migration 0029), so a session-scoped read silently returns no row rather than erroring; confirmed live during D6 verification, where this was a real bug (sourceType always null) before this test was added', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(mocks.getJobSource).toHaveBeenCalledWith(ADMIN_CLIENT, BASE_JOB.sourceId);
    expect(mocks.getJobSource).not.toHaveBeenCalledWith(SESSION_CLIENT, expect.anything());
  });

  it('passes the catalog canonical URL through for cross-path (extension) convergence', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.canonicalUrl).toBe(BASE_JOB.canonicalApplyUrl);
  });

  it('D7.1 (22): a resolved Jobright job uses the resolved employer canonical URL, never the Jobright detail URL, for the handoff', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue({
      ...BASE_JOB,
      sourceUrl: 'https://jobright.ai/jobs/info/abc123',
      applyUrl: 'https://jobright.ai/jobs/info/abc123',
      canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/9999', // D7.1-resolved
    });
    mocks.getJobSource.mockResolvedValue({ ...BASE_JOB_SOURCE, sourceType: 'JOBRIGHT_GITHUB' });

    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.canonicalUrl).toBe('https://boards.greenhouse.io/acme/jobs/9999');
    expect(input.canonicalUrl).not.toContain('jobright.ai');
  });

  it('D7.1 (23): an unresolved Jobright job never mislabels Jobright as the original employer posting — sourceType honestly says JOBRIGHT_GITHUB, never the employer\'s own ATS', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue({
      ...BASE_JOB,
      sourceUrl: 'https://jobright.ai/jobs/info/abc123',
      applyUrl: 'https://jobright.ai/jobs/info/abc123',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/abc123', // never resolved
    });
    mocks.getJobSource.mockResolvedValue({ ...BASE_JOB_SOURCE, sourceType: 'JOBRIGHT_GITHUB' });

    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.eventMetadata.sourceType).toBe('JOBRIGHT_GITHUB');
    expect(input.snapshot.sourceUrl).toContain('jobright.ai');
    expect(input.canonicalUrl).toBeNull();
  });

  it('bug fix: an unresolved/stale Jobright canonical_apply_url is never snapshotted onto the application as canonicalUrl — does not snapshot Jobright as the employer/original posting', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue({
      ...BASE_JOB,
      sourceUrl: 'https://jobright.ai/jobs/info/abc123',
      applyUrl: 'https://jobright.ai/jobs/info/abc123',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/abc123', // stale/never resolved
    });
    mocks.getJobSource.mockResolvedValue({ ...BASE_JOB_SOURCE, sourceType: 'JOBRIGHT_GITHUB' });

    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.canonicalUrl).toBeNull();
  });

  it('bug fix: an unlisted-but-legitimate employer ATS host still passes through unchanged — only known rejected aggregators are nulled', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue({
      ...BASE_JOB,
      canonicalApplyUrl: 'https://acme.example.com/apply/1', // not on the ACCEPTED_ATS allowlist, but not an aggregator either
    });

    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.canonicalUrl).toBe('https://acme.example.com/apply/1');
  });

  it('builds discovery-handoff event metadata from the real match score, never fabricated', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.eventMetadata).toEqual({
      jobCatalogId: JOB_CATALOG_ID,
      sourceType: 'GREENHOUSE',
      matchScore: 78,
      coverage: 65,
      eligibilityStatus: 'ELIGIBLE',
      rankingVersion: 'd4-ranking-v1',
      featureVersion: 'd4-features-v1',
      eligibilityVersion: 'd4-eligibility-v1',
    });
  });

  it('builds honest null event metadata when the job has not been scored for this user yet', async () => {
    mocks.getOwnMatchScore.mockResolvedValue(null);
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(input.eventMetadata.matchScore).toBeNull();
    expect(input.eventMetadata.coverage).toBeNull();
    expect(input.eventMetadata.eligibilityStatus).toBeNull();
  });

  it('never puts the job description or any large payload into the event metadata', async () => {
    await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const [, , input] = mocks.startApplicationFromCatalogJob.mock.calls[0]!;
    expect(JSON.stringify(input.eventMetadata)).not.toContain('Build things.');
  });

  it('allows starting an application for a CLOSED catalog job — never silently blocked', async () => {
    mocks.getJobCatalogEntryById.mockResolvedValue({ ...BASE_JOB, status: 'CLOSED' });
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(response.status).toBe(200);
    expect(mocks.startApplicationFromCatalogJob).toHaveBeenCalled();
  });

  it('reports created=false when an idempotent repeat call returns the existing application', async () => {
    mocks.startApplicationFromCatalogJob.mockResolvedValue({
      applicationId: 'app-1',
      created: false,
      status: 'SAVED',
      jobSnapshotId: 'snap-1',
    });
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    const body = await response.json();
    expect(body.created).toBe(false);
    expect(body.applicationId).toBe('app-1');
  });

  it('returns 502 with an actionable error when the RPC call fails, never a silent success', async () => {
    mocks.startApplicationFromCatalogJob.mockRejectedValue(new Error('db exploded'));
    const response = await POST(postRequest(), paramsFor(JOB_CATALOG_ID));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
  });

  it('never triggers resume tailoring, company research, interview prep, or any AI call', async () => {
    // Structural: this route imports only database/shared/auth/supabase helpers — no @career-os/ai
    // import exists in the module at all, so there is no code path here that could call one.
    const routeSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./route.ts', import.meta.url), 'utf-8'),
    );
    expect(routeSource).not.toMatch(/@career-os\/ai|tavily|anthropic|claude/i);
  });
});
