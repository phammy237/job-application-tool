import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import {
  listResolvedPostingsForRevalidation,
  recordOfficialPostingLivenessCheck,
  recordOfficialPostingRevalidationDemotion,
} from '@career-os/database';
import { tavilySearch } from '@career-os/ai';
import { runOfficialPostingRevalidation } from './official-posting-revalidation';

// Candidate-page fetches resolve DNS before every hop; keep unit tests off the network.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('@career-os/ai', () => ({ tavilySearch: vi.fn() }));
vi.mock('@career-os/database', () => ({
  listResolvedPostingsForRevalidation: vi.fn(),
  recordOfficialPostingLivenessCheck: vi.fn(),
  recordOfficialPostingRevalidationDemotion: vi.fn(),
}));

const supabase = {} as CareerOsSupabaseClient;
const NOW = new Date('2026-09-21T00:00:00.000Z');

const QTS_URL =
  'https://qtsdatacenters.wd5.myworkdayjobs.com/QTS/job/Suwanee-GA/Summer-2026-Internship--IT-Asset-Management_R2025-0980';
const GARMIN_URL = 'https://careers.garmin.com/jobs/20154?lang=en-us';

const QTS_ROW = {
  jobCatalogId: 'qts',
  companyName: 'QTS Data Centers',
  title: 'Summer 2027 Internship: Process Analytics - Technology Delivery Team',
  canonicalApplyUrl: QTS_URL,
  linkCheckFailures: 0,
};
const GARMIN_ROW = {
  jobCatalogId: 'garmin',
  companyName: 'Garmin',
  title: 'Business Analyst Intern',
  canonicalApplyUrl: GARMIN_URL,
  linkCheckFailures: 0,
};

const CLOSED_SHELL =
  '<html><head><title></title></head><body><script>window.workday = { postingAvailable: false };</script></body></html>';
const page = (title: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title })}</script></head></html>`;

function serve(byUrl: Record<string, string | Error>) {
  const fetchMock = vi.fn(async (url: string) => {
    const entry = byUrl[url];
    if (entry instanceof Error) throw entry;
    return entry === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => entry };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function run(rows: (typeof QTS_ROW)[], dryRun = false) {
  vi.mocked(listResolvedPostingsForRevalidation).mockResolvedValue(rows);
  return runOfficialPostingRevalidation(supabase, { jobrightSourceIds: ['s1'] }, { maxCount: 100, dryRun, now: NOW });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('runOfficialPostingRevalidation', () => {
  it('leaves a page-confirmed HIGH row completely untouched (no write at all)', async () => {
    serve({ [GARMIN_URL]: page('Business Analyst Intern') });
    const summary = await run([GARMIN_ROW]);
    expect(summary).toMatchObject({ checked: 1, unchanged: 1, demotedToReview: 0, demotedToUnresolved: 0 });
    expect(summary.byOutcome).toEqual({ CONFIRMED: 1 });
    expect(recordOfficialPostingRevalidationDemotion).not.toHaveBeenCalled();
    expect(recordOfficialPostingLivenessCheck).not.toHaveBeenCalled();
  });

  it('QTS: a closed accepted-ATS page is demoted to REVIEW, keeping the old URL as the candidate', async () => {
    serve({ [QTS_URL]: CLOSED_SHELL });
    const summary = await run([QTS_ROW]);
    expect(summary.demotedToReview).toBe(1);
    expect(summary.rows[0]).toMatchObject({ outcome: 'CLOSED', action: 'DEMOTED_TO_REVIEW' });
    expect(recordOfficialPostingRevalidationDemotion).toHaveBeenCalledWith(
      supabase,
      'qts',
      { to: 'RESOLVED_REVIEW', candidateUrl: QTS_URL, confidence: 72 },
      NOW,
    );
  });

  it('an accepted-ATS row whose page exposes no identity is demoted to REVIEW', async () => {
    serve({ [QTS_URL]: '<html><body>rendered client-side</body></html>' });
    const summary = await run([QTS_ROW]);
    expect(summary.rows[0]).toMatchObject({ outcome: 'IDENTITY_UNAVAILABLE', action: 'DEMOTED_TO_REVIEW' });
  });

  it('an employer-owned row whose page exposes no identity keeps HIGH (no write)', async () => {
    serve({ [GARMIN_URL]: '<html><head><title>Garmin Careers</title></head></html>' });
    const summary = await run([GARMIN_ROW]);
    expect(summary.rows[0]).toMatchObject({ outcome: 'IDENTITY_UNAVAILABLE', action: 'UNCHANGED' });
    expect(recordOfficialPostingRevalidationDemotion).not.toHaveBeenCalled();
  });

  it('a page that positively identifies a different job demotes to UNRESOLVED, keeping no candidate URL', async () => {
    serve({ [GARMIN_URL]: page('Senior Software Engineer') });
    const summary = await run([GARMIN_ROW]);
    expect(summary.demotedToUnresolved).toBe(1);
    expect(recordOfficialPostingRevalidationDemotion).toHaveBeenCalledWith(supabase, 'garmin', { to: 'UNRESOLVED' }, NOW);
  });

  it('an unreachable page only records a link failure (existing two-strike), it never demotes directly', async () => {
    serve({ [GARMIN_URL]: new Error('boom') });
    const summary = await run([{ ...GARMIN_ROW, linkCheckFailures: 1 }]);
    expect(summary.linkFailuresRecorded).toBe(1);
    expect(recordOfficialPostingLivenessCheck).toHaveBeenCalledWith(supabase, 'garmin', { reachable: false }, 1, NOW);
    expect(recordOfficialPostingRevalidationDemotion).not.toHaveBeenCalled();
  });

  it('a confirmed row with a prior link failure resets the counter', async () => {
    serve({ [GARMIN_URL]: page('Business Analyst Intern') });
    await run([{ ...GARMIN_ROW, linkCheckFailures: 1 }]);
    expect(recordOfficialPostingLivenessCheck).toHaveBeenCalledWith(supabase, 'garmin', { reachable: true }, 1, NOW);
  });

  it('dry run reports the same decisions but writes nothing', async () => {
    serve({ [QTS_URL]: CLOSED_SHELL, [GARMIN_URL]: page('Senior Software Engineer') });
    const summary = await run([QTS_ROW, GARMIN_ROW], true);
    expect(summary).toMatchObject({ checked: 2, demotedToReview: 1, demotedToUnresolved: 1 });
    expect(recordOfficialPostingRevalidationDemotion).not.toHaveBeenCalled();
    expect(recordOfficialPostingLivenessCheck).not.toHaveBeenCalled();
  });

  it('reports the final host when a stored URL legitimately redirects to another domain, without changing the decision', async () => {
    const tiktokUrl = 'https://careers.tiktok.com/m/position/7662640431646279989/detail';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === tiktokUrl
          ? new Response(null, { status: 302, headers: { location: 'https://lifeattiktok.com/search/7662640431646279989' } })
          : new Response(page('Product Strategy Analyst Project Intern'), { status: 200 }),
      ),
    );
    const summary = await run([
      { ...GARMIN_ROW, jobCatalogId: 'tiktok', companyName: 'TikTok', title: 'Product Strategy Analyst Project Intern', canonicalApplyUrl: tiktokUrl },
    ]);
    expect(summary.rows[0]).toMatchObject({ outcome: 'CONFIRMED', action: 'UNCHANGED', redirectedToHost: 'lifeattiktok.com' });
  });

  it('a stored URL that now redirects to an internal address is unreachable (one link failure), never followed', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === GARMIN_URL ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }) : new Response('x', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const summary = await run([GARMIN_ROW]);
    expect(summary.rows[0]).toMatchObject({ outcome: 'UNREACHABLE', action: 'LINK_FAILURE_RECORDED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never searches, and fetches exactly the stored canonical URL once per row', async () => {
    const fetchMock = serve({ [QTS_URL]: CLOSED_SHELL, [GARMIN_URL]: page('Business Analyst Intern') });
    await run([QTS_ROW, GARMIN_ROW]);
    expect(tavilySearch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([QTS_URL, GARMIN_URL]);
  });

  it('is idempotent: an unchanged row yields the same result and still no write on a repeat run', async () => {
    serve({ [GARMIN_URL]: page('Business Analyst Intern') });
    const first = await run([GARMIN_ROW]);
    const second = await run([GARMIN_ROW]);
    expect(second.rows).toEqual(first.rows);
    expect(recordOfficialPostingRevalidationDemotion).not.toHaveBeenCalled();
  });
});
