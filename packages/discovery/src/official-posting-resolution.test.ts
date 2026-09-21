import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import { buildCrossSourceDedupeIndex } from './dedupe/cross-source-dedupe';
import {
  mergeIntoAtsMatch,
  decideHighFromConfirmation,
  resolveViaCatalogMatch,
  resolveViaSearch,
  runOfficialPostingResolution,
} from './official-posting-resolution';

/** Minimal in-memory multi-table fake mirroring the exact PostgREST call shapes this module's
 * database-layer callees issue (`job_sources`, `job_catalog`, `user_job_match_scores`) — same
 * technique as `orchestrator/sync-source.test.ts`, extended with `.delete()`. */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}
interface FakeTables {
  job_sources: FakeRow[];
  job_catalog: FakeRow[];
  user_job_match_scores: FakeRow[];
}
class FakeStore {
  tables: FakeTables = { job_sources: [], job_catalog: [], user_job_match_scores: [] };
}
class FakeQuery {
  private op: 'select' | 'update' | 'delete' | null = null;
  private filters: Array<['eq' | 'in', string, unknown]> = [];
  private selectCols: string[] | null = null;
  private payload: Record<string, unknown> | null = null;

  constructor(
    private readonly store: FakeStore,
    private readonly table: keyof FakeTables,
  ) {}

  select(cols: string): this {
    this.op = 'select';
    this.selectCols = cols.split(',').map((c) => c.trim());
    return this;
  }
  order(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push(['eq', col, value]);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push(['in', col, values]);
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }

  private rows(): FakeRow[] {
    return this.store.tables[this.table];
  }
  private matches(row: FakeRow): boolean {
    return this.filters.every(([kind, col, value]) => {
      if (kind === 'eq') return row[col] === value;
      return (value as unknown[]).includes(row[col]);
    });
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    const matched = this.rows().find((row) => this.matches(row)) ?? null;
    if (!matched) return { data: null, error: null };
    const picked: Record<string, unknown> = {};
    for (const col of this.selectCols ?? []) picked[col] = col === '*' ? matched : matched[col];
    return { data: this.selectCols?.includes('*') ? matched : picked, error: null };
  }

  then(resolve: (value: { data: unknown; error: null }) => void, reject: (reason: unknown) => void): void {
    try {
      resolve(this.execute());
    } catch (error) {
      reject(error);
    }
  }

  private execute(): { data: unknown; error: null } {
    if (this.op === 'select') {
      const matched = this.rows().filter((row) => this.matches(row));
      const data = matched.map((row) => {
        if (this.selectCols?.includes('*')) return row;
        const picked: Record<string, unknown> = {};
        for (const col of this.selectCols ?? []) picked[col] = row[col];
        return picked;
      });
      return { data, error: null };
    }
    if (this.op === 'update') {
      for (const row of this.rows().filter((r) => this.matches(r))) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    if (this.op === 'delete') {
      const remaining = this.rows().filter((row) => !this.matches(row));
      this.store.tables[this.table] = remaining;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}
function fakeSupabase(store: FakeStore): CareerOsSupabaseClient {
  return { from: (table: keyof FakeTables) => new FakeQuery(store, table) } as unknown as CareerOsSupabaseClient;
}

// Candidate-page fetches resolve DNS before every hop; keep unit tests off the network.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('@career-os/ai', () => ({ tavilySearch: vi.fn() }));
import { tavilySearch } from '@career-os/ai';
const mockedTavilySearch = vi.mocked(tavilySearch);

afterEach(() => {
  vi.clearAllMocks();
});

// An accepted-ATS (Greenhouse) HIGH must now be confirmed by the page itself, so the fixtures that
// exercise the Databricks Greenhouse flow serve a page whose JobPosting title matches.
const DATABRICKS_PAGE =
  '<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Product Management Intern (Summer 2027)"}</script></head><body></body></html>';

const GREENHOUSE_ROW = {
  jobCatalogId: 'gh-1',
  sourceId: 'source-greenhouse',
  companyName: 'Datadog',
  title: 'Product Management Intern',
  locationText: 'New York, NY, United States',
  canonicalApplyUrl: 'https://boards.greenhouse.io/datadog/jobs/1234',
  postedAt: '2026-09-15T00:00:00.000Z',
};
const LEVER_ROW = {
  jobCatalogId: 'lever-1',
  sourceId: 'source-lever',
  companyName: 'Palantir',
  title: 'Forward Deployed Engineer Intern',
  locationText: 'Palo Alto, CA, United States',
  canonicalApplyUrl: 'https://jobs.lever.co/palantir/5678',
  postedAt: '2026-09-14T00:00:00.000Z',
};
const ASHBY_ROW = {
  jobCatalogId: 'ashby-1',
  sourceId: 'source-ashby',
  companyName: 'Notion',
  title: 'Data Science Intern',
  locationText: 'San Francisco, CA, United States',
  canonicalApplyUrl: 'https://jobs.ashbyhq.com/notion/9012',
  postedAt: '2026-09-13T00:00:00.000Z',
};

describe('resolveViaCatalogMatch (Strategy A)', () => {
  it('1. a Jobright row matches an existing Greenhouse job', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      postedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('gh-1');
  });

  it('2. a Jobright row matches an existing Lever job', () => {
    const index = buildCrossSourceDedupeIndex([LEVER_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Palantir',
      title: 'Forward Deployed Engineer Intern',
      locationText: 'Palo Alto, CA, United States',
      postedAt: null,
    });
    expect(match?.jobCatalogId).toBe('lever-1');
  });

  it('3. a Jobright row matches an existing Ashby job', () => {
    const index = buildCrossSourceDedupeIndex([ASHBY_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Notion',
      title: 'Data Science Intern',
      locationText: 'San Francisco, CA, United States',
      postedAt: '2026-09-13T00:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('ashby-1');
  });

  it('4. the same title in a different location never false-matches', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'San Francisco, CA, United States',
      postedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });

  it('5. the same company with a genuinely different requisition (far-apart posted dates) never false-matches', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = resolveViaCatalogMatch(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });
});

describe('resolveViaSearch (Strategy B)', () => {
  const CANDIDATE = { companyName: 'Databricks', title: 'Product Management Intern (Summer 2027)', locationText: 'San Francisco, CA' };

  it('accepts a HIGH-confidence result and confirms it is reachable', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://boards.greenhouse.io/databricks/jobs/1234',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring a Product Management Intern for Summer 2027 in San Francisco, CA.',
          publishedDate: null,
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => DATABRICKS_PAGE }));

    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    if (result.tier === 'RESOLVED_HIGH_CONFIDENCE') {
      expect(result.url).toBe('https://boards.greenhouse.io/databricks/jobs/1234');
    }
    vi.unstubAllGlobals();
  });

  it('returns UNRESOLVED when every result is an aggregator or a weak match', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://www.linkedin.com/jobs/view/1234',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring.',
          publishedDate: null,
        },
      ],
    });
    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('returns UNRESOLVED when search is unavailable (no API key configured)', async () => {
    mockedTavilySearch.mockResolvedValue({ status: 'unavailable' });
    const result = await resolveViaSearch(CANDIDATE);
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('production case: promotes a REVIEW employer-domain-matched candidate to HIGH after content verification confirms hiringOrganization.name + title on the candidate page itself', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
          // Weak title overlap in the SEARCH SNIPPET alone — reaches REVIEW, not HIGH,
          // structurally (validated by official-posting-validator.test.ts's own case).
          title: 'Business Analyst I - Cisco Careers',
          content: 'Cisco is hiring for a Business Analyst I role.',
          publishedDate: null,
        },
      ],
    });
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Business Analyst I Intern',
      hiringOrganization: { '@type': 'Organization', name: 'Cisco' },
    })}</script></head><body></body></html>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }));

    const result = await resolveViaSearch({
      companyName: 'Cisco',
      title: 'Business Analyst I Intern',
      locationText: null,
    });

    expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    if (result.tier === 'RESOLVED_HIGH_CONFIDENCE') {
      expect(result.url).toBe(
        'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
      );
      expect(result.confidence).toBe(95);
    }
    vi.unstubAllGlobals();
  });

  it('does not promote when the candidate page has no JobPosting JSON-LD — stays REVIEW, never a crash', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
          title: 'Business Analyst I - Cisco Careers',
          content: 'Cisco is hiring for a Business Analyst I role.',
          publishedDate: null,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<html><body>no structured data</body></html>' }),
    );

    const result = await resolveViaSearch({
      companyName: 'Cisco',
      title: 'Business Analyst I Intern',
      locationText: null,
    });

    expect(result.tier).toBe('RESOLVED_REVIEW');
    vi.unstubAllGlobals();
  });

  it('does not promote when the candidate page JSON-LD names a different employer — stays REVIEW, never trusts the domain alone', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
          title: 'Business Analyst I - Cisco Careers',
          content: 'Cisco is hiring for a Business Analyst I role.',
          publishedDate: null,
        },
      ],
    });
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Business Analyst I Intern',
      hiringOrganization: { '@type': 'Organization', name: 'Some Other Company' },
    })}</script></head><body></body></html>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }));

    const result = await resolveViaSearch({
      companyName: 'Cisco',
      title: 'Business Analyst I Intern',
      locationText: null,
    });

    expect(result.tier).toBe('RESOLVED_REVIEW');
    vi.unstubAllGlobals();
  });

  it('never attempts a verification fetch for a candidate whose domain does not match the company at all (no employer-domain evidence)', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://some-unrelated-board.example/job/cisco-business-analyst',
          title: 'Business Analyst I Intern - Cisco',
          content: 'Cisco is hiring a Business Analyst I Intern.',
          publishedDate: null,
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveViaSearch({
      companyName: 'Cisco',
      title: 'Business Analyst I Intern',
      locationText: null,
    });

    expect(result.tier).toBe('RESOLVED_REVIEW');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('never promotes a third-party mirror (BeBee) to HIGH even when title/company text matches well', async () => {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://www.bebee.com/job/cisco-business-analyst-i-intern',
          title: 'Business Analyst I Intern - Cisco',
          content: 'Cisco is hiring a Business Analyst I Intern.',
          publishedDate: null,
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveViaSearch({
      companyName: 'Cisco',
      title: 'Business Analyst I Intern',
      locationText: null,
    });

    expect(result.tier).toBe('UNRESOLVED');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('resolveViaSearch — page identity confirmation of a structural HIGH', () => {
  const QTS = {
    companyName: 'QTS Data Centers',
    title: 'Summer 2027 Internship: Process Analytics - Technology Delivery Team',
    locationText: 'Suwanee, GA, United States',
  };
  const QTS_WORKDAY_URL =
    'https://qtsdatacenters.wd5.myworkdayjobs.com/QTS/job/Suwanee-GA/Summer-2026-Internship--IT-Asset-Management_R2025-0980';
  // Search evidence carrying the EXPECTED title on an official Workday host — the only shape that
  // can reach structural HIGH (the validator scores the snippet title, never the page).
  const qtsSnippetResult = {
    url: QTS_WORKDAY_URL,
    title: 'Summer 2027 Internship: Process Analytics - Technology Delivery Team - QTS Data Centers',
    content: 'QTS Data Centers is hiring a Summer 2027 intern in Suwanee, GA.',
  };
  const GARMIN = { companyName: 'Garmin', title: 'Business Analyst Intern', locationText: null };
  const garminSnippetResult = {
    url: 'https://careers.garmin.com/jobs/20154?lang=en-us',
    title: 'Business Analyst Intern | Garmin Careers',
    content: 'Garmin is hiring a Business Analyst Intern in Olathe, KS.',
  };

  // Real shape of the closed QTS requisition: the Workday client-rendered shell, HTTP 200, empty
  // <title>/og:title, and `postingAvailable: false` in the bootstrap script.
  const CLOSED_WORKDAY_SHELL = `<!DOCTYPE html><html lang="en-US"><head><title></title>
    <meta name="title" property="og:title"><script type="text/javascript">
    window.workday = window.workday || { tenant: "qtsdatacenters", siteId: "QTS", isExternal: true,
    appName: "cxs", postingAvailable: false, allowedFileTypes: [] };</script></head>
    <body><div id="root"></div></body></html>`;
  const LIVE_WORKDAY_SHELL = CLOSED_WORKDAY_SHELL.replace('postingAvailable: false', 'postingAvailable: true');

  function page(opts: { jsonLd?: Record<string, unknown>; ogTitle?: string; title?: string } = {}): string {
    const head: string[] = [];
    if (opts.title !== undefined) head.push(`<title>${opts.title}</title>`);
    if (opts.ogTitle !== undefined) head.push(`<meta property="og:title" content="${opts.ogTitle}">`);
    if (opts.jsonLd) {
      head.push(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', ...opts.jsonLd })}</script>`);
    }
    return `<html><head>${head.join('')}</head><body></body></html>`;
  }
  function stubPages(byUrl: Record<string, string>) {
    const fetchMock = vi.fn(async (url: string) =>
      url in byUrl ? { ok: true, status: 200, text: async () => byUrl[url] } : { ok: false, status: 404 },
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  function searchReturns(...results: { url: string; title: string; content: string }[]) {
    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: results.map((r) => ({ ...r, publishedDate: null })),
    });
  }
  async function resolveQts(html: string) {
    searchReturns(qtsSnippetResult);
    stubPages({ [QTS_WORKDAY_URL]: html });
    const result = await resolveViaSearch(QTS);
    vi.unstubAllGlobals();
    return result;
  }
  async function resolveGarmin(html: string) {
    searchReturns(garminSnippetResult);
    stubPages({ [garminSnippetResult.url]: html });
    const result = await resolveViaSearch(GARMIN);
    vi.unstubAllGlobals();
    return result;
  }

  describe('accepted ATS host (Workday)', () => {
    const MATCHING = 'Summer 2027 Internship: Process Analytics - Technology Delivery Team';

    it('matching JSON-LD title (empty Workday hiringOrganization.name ignored) → HIGH', async () => {
      const result = await resolveQts(page({ jsonLd: { title: MATCHING, hiringOrganization: { name: '' } } }));
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('matching og:title (no JSON-LD) → HIGH', async () => {
      expect((await resolveQts(page({ ogTitle: MATCHING }))).tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('matching HTML <title> (no JSON-LD, no og:title) → HIGH', async () => {
      expect((await resolveQts(page({ title: `${MATCHING} | QTS Careers` }))).tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('a colon/dash difference in an otherwise identical page title is not a conflict', async () => {
      const result = await resolveQts(
        page({ ogTitle: 'Summer 2027 Internship - Process Analytics - Technology Delivery Team' }),
      );
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('no extractable identity (plain page) → REVIEW, not HIGH', async () => {
      const result = await resolveQts('<html><body>rendered client-side</body></html>');
      expect(result.tier).toBe('RESOLVED_REVIEW');
    });

    it('a live Workday shell with no title data → REVIEW, not HIGH', async () => {
      expect((await resolveQts(LIVE_WORKDAY_SHELL)).tier).toBe('RESOLVED_REVIEW');
    });

    it.each([
      ['Careers', page({ title: 'Careers' })],
      ['Jobs', page({ ogTitle: 'Jobs' })],
      ['Search Jobs', page({ title: 'Search Jobs' })],
      ['company-name-only', page({ title: 'QTS Data Centers' })],
      ['"<company> Careers"', page({ ogTitle: 'QTS Data Centers Careers' })],
      ['"Careers at <company>"', page({ title: 'Careers at QTS Data Centers' })],
    ])('generic page title (%s) is not job identity → REVIEW', async (_label, html) => {
      expect((await resolveQts(html)).tier).toBe('RESOLVED_REVIEW');
    });

    it('conflicting JSON-LD title → not HIGH and not even a REVIEW candidate', async () => {
      const result = await resolveQts(page({ jsonLd: { title: 'Summer 2026 Internship: IT Asset Management' } }));
      expect(result.tier).toBe('UNRESOLVED');
    });

    it('conflicting og:title → not HIGH', async () => {
      const result = await resolveQts(page({ ogTitle: 'Summer 2026 Internship: IT Asset Management' }));
      expect(result.tier).toBe('UNRESOLVED');
    });

    it('QTS shape: closed Workday shell (HTTP 200, empty title, postingAvailable:false) → REVIEW', async () => {
      const result = await resolveQts(CLOSED_WORKDAY_SHELL);
      expect(result.tier).toBe('RESOLVED_REVIEW');
      if (result.tier === 'RESOLVED_REVIEW') expect(result.url).toBe(QTS_WORKDAY_URL);
    });

    it('unreachable page → REVIEW', async () => {
      searchReturns(qtsSnippetResult);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      expect((await resolveViaSearch(QTS)).tier).toBe('RESOLVED_REVIEW');
      vi.unstubAllGlobals();
    });

    describe('Workday /apply URLs', () => {
      const DETAIL =
        'https://tencent.wd1.myworkdayjobs.com/Tencent_Careers/job/Tencent-Cloud-CPaaS-Product-Management-Intern_R108020';
      const TENCENT = { companyName: 'Tencent', title: 'Tencent Cloud CPaaS Product Management Intern', locationText: null };
      const applySnippet = {
        url: `${DETAIL}/apply`,
        title: 'Tencent Cloud CPaaS Product Management Intern - Tencent',
        content: 'Tencent is hiring a Tencent Cloud CPaaS Product Management Intern.',
      };

      it('reads identity from the detail page (the /apply shell falsely reports closed) — HIGH, one request, no extra fetch', async () => {
        searchReturns(applySnippet);
        const fetchMock = stubPages({
          [`${DETAIL}/apply`]: CLOSED_WORKDAY_SHELL,
          [DETAIL]: page({ jsonLd: { title: 'Tencent Cloud CPaaS Product Management Intern' } }),
        });
        const result = await resolveViaSearch(TENCENT);
        expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
        if (result.tier === 'RESOLVED_HIGH_CONFIDENCE') expect(result.url).toBe(`${DETAIL}/apply`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(DETAIL);
        vi.unstubAllGlobals();
      });

      it('a genuinely closed detail page still demotes an /apply URL → REVIEW', async () => {
        searchReturns(applySnippet);
        stubPages({ [DETAIL]: CLOSED_WORKDAY_SHELL });
        expect((await resolveViaSearch(TENCENT)).tier).toBe('RESOLVED_REVIEW');
        vi.unstubAllGlobals();
      });
    });
  });

  describe('exact employer-owned domain', () => {
    it('matching JSON-LD title with an opaque URL → HIGH', async () => {
      const result = await resolveGarmin(page({ jsonLd: { title: 'Business Analyst Intern', hiringOrganization: { name: 'Garmin' } } }));
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('no identity at all → existing HIGH behavior preserved', async () => {
      expect((await resolveGarmin('<html><body>rendered client-side</body></html>')).tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('only a generic <title> ("Garmin Careers") → existing HIGH behavior preserved', async () => {
      expect((await resolveGarmin(page({ title: 'Garmin Careers' }))).tier).toBe('RESOLVED_HIGH_CONFIDENCE');
    });

    it('conflicting JSON-LD title → not HIGH', async () => {
      expect((await resolveGarmin(page({ jsonLd: { title: 'Senior Software Engineer' } }))).tier).toBe('UNRESOLVED');
    });

    it('conflicting og:title → not HIGH', async () => {
      expect((await resolveGarmin(page({ ogTitle: 'Senior Software Engineer' }))).tier).toBe('UNRESOLVED');
    });

    it('JSON-LD names a different employer → not HIGH', async () => {
      const result = await resolveGarmin(
        page({ jsonLd: { title: 'Business Analyst Intern', hiringOrganization: { name: 'Some Other Company' } } }),
      );
      expect(result.tier).toBe('UNRESOLVED');
    });

    it('a closed page → REVIEW', async () => {
      expect((await resolveGarmin(CLOSED_WORKDAY_SHELL)).tier).toBe('RESOLVED_REVIEW');
    });

    it('unreachable page → REVIEW', async () => {
      searchReturns(garminSnippetResult);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      expect((await resolveViaSearch(GARMIN)).tier).toBe('RESOLVED_REVIEW');
      vi.unstubAllGlobals();
    });

    it('Boston Scientific shape: HTML <title> carries a "Job Details | Boston Scientific" suffix the catalog title also has in another form → HIGH', async () => {
      const url = 'https://jobs.bostonscientific.com/job/St_-Paul-IT-Analyst-Intern-Minnesota-MN-55101/1429599000';
      searchReturns({
        url,
        title: 'IT Analyst Intern- Minnesota Job Details | Boston Scientific',
        content: 'Boston Scientific is hiring an IT Analyst Intern in Minnesota.',
      });
      stubPages({
        [url]: page({ title: 'IT Analyst Intern- Minnesota Job Details | Boston Scientific', ogTitle: 'IT Analyst Intern- Minnesota' }),
      });
      const result = await resolveViaSearch({
        companyName: 'Boston Scientific',
        title: 'IT Analyst Intern- Minnesota Job Details / Boston Scientific',
        locationText: 'Arden Hills, MN, United States',
      });
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
      vi.unstubAllGlobals();
    });

    it('a sibling role (Product Design vs Product Manager) is vetoed on the page title', async () => {
      const url = 'https://jobs.intuit.com/job/mountain-view/summer-2027-product-manager-intern/27595/100620927648';
      searchReturns({ url, title: 'Summer 2027: Product Manager Intern - Intuit', content: 'Intuit is hiring a Product Manager Intern.' });
      stubPages({ [url]: page({ jsonLd: { title: 'Summer 2027: Product Design Intern', hiringOrganization: { name: 'Intuit' } } }) });
      const result = await resolveViaSearch({ companyName: 'Intuit', title: 'Summer 2027: Product Manager Intern', locationText: null });
      expect(result.tier).toBe('UNRESOLVED');
      vi.unstubAllGlobals();
    });
  });

  describe('redirect-safe page fetching', () => {
    const TIKTOK = { companyName: 'TikTok', title: 'Product Strategy Analyst Project Intern', locationText: null };
    const TIKTOK_URL = 'https://careers.tiktok.com/m/position/7662640431646279989/detail';
    const tiktokSnippet = {
      url: TIKTOK_URL,
      title: 'Product Strategy Analyst Project Intern - TikTok',
      content: 'TikTok is hiring a Product Strategy Analyst Project Intern.',
    };
    const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });
    function stubRoutes(routes: Record<string, () => Response>) {
      const fetchMock = vi.fn(async (url: string) => {
        const handler = routes[url];
        if (!handler) throw new Error(`unexpected request to ${url}`);
        return handler();
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('a legitimate cross-host redirect (careers.tiktok.com → lifeattiktok.com) is followed and identity is read from the destination → HIGH', async () => {
      searchReturns(tiktokSnippet);
      const fetchMock = stubRoutes({
        [TIKTOK_URL]: () => redirectTo('https://lifeattiktok.com/search/7662640431646279989'),
        'https://lifeattiktok.com/search/7662640431646279989': () =>
          new Response(page({ jsonLd: { title: 'Product Strategy Analyst Project Intern' } }), { status: 200 }),
      });
      const result = await resolveViaSearch(TIKTOK);
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
      if (result.tier === 'RESOLVED_HIGH_CONFIDENCE') expect(result.url).toBe(TIKTOK_URL); // stored URL is never rewritten
      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080/admin',
      'http://localhost/',
      'http://10.0.0.7/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'file:///etc/passwd',
    ])('a redirect to %s is never requested and demotes the HIGH to REVIEW', async (target) => {
      searchReturns(tiktokSnippet);
      const fetchMock = stubRoutes({ [TIKTOK_URL]: () => redirectTo(target) });
      const result = await resolveViaSearch(TIKTOK);
      expect(result.tier).toBe('RESOLVED_REVIEW');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('more than 5 redirects → REVIEW, and the 6th redirect target is never requested', async () => {
      searchReturns(tiktokSnippet);
      const routes: Record<string, () => Response> = { [TIKTOK_URL]: () => redirectTo('https://h1.example.com/') };
      for (let i = 1; i <= 5; i += 1) routes[`https://h${i}.example.com/`] = () => redirectTo(`https://h${i + 1}.example.com/`);
      const fetchMock = stubRoutes(routes);
      expect((await resolveViaSearch(TIKTOK)).tier).toBe('RESOLVED_REVIEW');
      expect(fetchMock).toHaveBeenCalledTimes(6);
      vi.unstubAllGlobals();
    });

    it('the 2 MB body cap still applies to the page reached AFTER a redirect', async () => {
      const chunk = new TextEncoder().encode(page({ jsonLd: { title: TIKTOK.title } }) + ' '.repeat(500_000));
      let pulls = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
          if (pulls > 100) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      searchReturns(tiktokSnippet);
      stubRoutes({
        [TIKTOK_URL]: () => redirectTo('https://lifeattiktok.com/x'),
        'https://lifeattiktok.com/x': () => new Response(stream, { status: 200 }),
      });
      expect((await resolveViaSearch(TIKTOK)).tier).toBe('RESOLVED_HIGH_CONFIDENCE');
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThan(10);
      vi.unstubAllGlobals();
    });

    it('the liveness check on a content-verified promotion also refuses an unsafe redirect (REVIEW, not HIGH)', async () => {
      const ciscoUrl = 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567';
      searchReturns({ url: ciscoUrl, title: 'Business Analyst I - Cisco Careers', content: 'Cisco is hiring for a Business Analyst I role.' });
      let getCount = 0;
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        if (url === ciscoUrl && init.method === 'GET') {
          getCount += 1;
          return new Response(
            page({ jsonLd: { title: 'Business Analyst I Intern', hiringOrganization: { name: 'Cisco' } } }),
            { status: 200 },
          );
        }
        if (url === ciscoUrl && init.method === 'HEAD') return redirectTo('http://169.254.169.254/');
        throw new Error(`unexpected request to ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = await resolveViaSearch({ companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null });
      expect(getCount).toBe(1);
      expect(result.tier).toBe('RESOLVED_REVIEW');
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('169.254'))).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  describe('fetch bounds', () => {
    it('makes exactly one page GET for the candidate selected for HIGH — no fetch per search result', async () => {
      searchReturns(
        qtsSnippetResult,
        { url: 'https://interninsider.me/internships/qts-data-centers/process-analytics-intern-x', title: 'Process Analytics Intern at QTS Data Centers', content: 'QTS Data Centers' },
        { url: 'https://www.linkedin.com/jobs/view/1', title: qtsSnippetResult.title, content: 'QTS Data Centers' },
      );
      const fetchMock = stubPages({ [QTS_WORKDAY_URL]: page({ jsonLd: { title: QTS.title } }) });
      await resolveViaSearch(QTS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(QTS_WORKDAY_URL);
      vi.unstubAllGlobals();
    });

    it('stops reading an oversized body at the cap, cancels the stream, and still extracts identity from the head', async () => {
      const head = page({ jsonLd: { title: QTS.title } });
      const chunk = new TextEncoder().encode(head + ' '.repeat(500_000));
      let pulls = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
          if (pulls > 100) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      searchReturns(qtsSnippetResult);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
      const result = await resolveViaSearch(QTS);
      expect(result.tier).toBe('RESOLVED_HIGH_CONFIDENCE');
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThan(10);
      vi.unstubAllGlobals();
    });
  });
});

describe('decideHighFromConfirmation', () => {
  it.each([
    ['CONFIRMED', 'ACCEPTED_ATS', 'HIGH'],
    ['CONFIRMED', 'UNKNOWN', 'HIGH'],
    ['IDENTITY_UNAVAILABLE', 'ACCEPTED_ATS', 'REVIEW'],
    ['IDENTITY_UNAVAILABLE', 'UNKNOWN', 'HIGH'],
    ['IDENTITY_UNAVAILABLE', 'EMPLOYER_DOMAIN', 'HIGH'],
    ['MISMATCH', 'ACCEPTED_ATS', 'DROP'],
    ['MISMATCH', 'UNKNOWN', 'DROP'],
    ['CLOSED', 'ACCEPTED_ATS', 'REVIEW'],
    ['CLOSED', 'UNKNOWN', 'REVIEW'],
    ['UNREACHABLE', 'ACCEPTED_ATS', 'REVIEW'],
    ['UNREACHABLE', 'UNKNOWN', 'REVIEW'],
  ] as const)('%s on %s → %s', (outcome, hostClass, expected) => {
    expect(decideHighFromConfirmation(outcome, hostClass)).toBe(expected);
  });
});

describe('mergeIntoAtsMatch', () => {
  it('appends the cross-source observation, deletes match scores, and marks the row MERGED', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push(
      { id: 'ats-1', cross_source_observations: [], status: 'ACTIVE' },
      {
        id: 'jobright-1',
        status: 'ACTIVE',
        resolution_status: 'NOT_ATTEMPTED',
        resolution_attempt_count: 0,
        source_url: 'https://jobright.ai/jobs/info/abc123',
        canonical_apply_url: 'https://jobright.ai/jobs/info/abc123',
      },
    );
    store.tables.user_job_match_scores.push(
      { id: 'score-1', job_catalog_id: 'jobright-1' },
      { id: 'score-2', job_catalog_id: 'ats-1' },
    );
    const supabase = fakeSupabase(store);

    await mergeIntoAtsMatch(
      supabase,
      {
        jobrightJobCatalogId: 'jobright-1',
        atsJobCatalogId: 'ats-1',
        sourceIdentifier: 'jobright-ai/2026-Product-Management-Internship',
        sourceJobId: 'abc123',
        sourceUrl: 'https://jobright.ai/jobs/info/abc123',
      },
      new Date('2026-09-18T00:00:00.000Z'),
    );

    const atsRow = store.tables.job_catalog.find((r) => r.id === 'ats-1')!;
    expect(atsRow.cross_source_observations).toEqual([
      {
        provider: 'JOBRIGHT_GITHUB',
        sourceIdentifier: 'jobright-ai/2026-Product-Management-Internship',
        sourceJobId: 'abc123',
        sourceUrl: 'https://jobright.ai/jobs/info/abc123',
        observedAt: '2026-09-18T00:00:00.000Z',
      },
    ]);

    const jobrightRow = store.tables.job_catalog.find((r) => r.id === 'jobright-1')!;
    expect(jobrightRow.status).toBe('MERGED');
    expect(jobrightRow.resolution_status).toBe('RESOLVED_HIGH_CONFIDENCE');
    expect(jobrightRow.resolution_strategy).toBe('CATALOG_MATCH');
    // 19. source_url (discovery provenance) is never touched by a merge — only status/resolution_*.
    expect(jobrightRow.source_url).toBe('https://jobright.ai/jobs/info/abc123');
    expect(jobrightRow.canonical_apply_url).toBe('https://jobright.ai/jobs/info/abc123');

    // The Jobright row's own match score is gone; the ATS row's own score is untouched.
    expect(store.tables.user_job_match_scores.map((s) => s.job_catalog_id)).toEqual(['ats-1']);
  });
});

describe('runOfficialPostingResolution', () => {
  it('prefers Strategy A over Strategy B — never calls search when a catalog match already exists', async () => {
    const store = new FakeStore();
    function sourceRow(overrides: Partial<FakeRow> & { id: string }): FakeRow {
      return {
        company_name: 'placeholder',
        source_type: 'GREENHOUSE',
        source_identifier: 'placeholder',
        careers_url: null,
        enabled: true,
        crawl_interval_hours: 24,
        last_crawled_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error: null,
        consecutive_failures: 0,
        etag: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }
    store.tables.job_sources.push(
      sourceRow({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        source_type: 'GREENHOUSE',
        source_identifier: 'datadog',
        company_name: 'Datadog',
      }),
      sourceRow({
        id: 'bbbbbbbb-0000-4000-8000-000000000002',
        source_type: 'JOBRIGHT_GITHUB',
        source_identifier: 'jobright-ai/2026-Product-Management-Internship',
        company_name: 'Jobright — Product Management Internships',
      }),
    );
    store.tables.job_catalog.push(
      {
        id: 'ats-1',
        source_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        company_name: 'Datadog',
        title: 'Product Management Intern',
        location_text: 'New York, NY, United States',
        canonical_apply_url: 'https://boards.greenhouse.io/datadog/jobs/1234',
        posted_at: '2026-09-15T00:00:00.000Z',
        status: 'ACTIVE',
        cross_source_observations: [],
      },
      {
        id: 'jobright-1',
        source_id: 'bbbbbbbb-0000-4000-8000-000000000002',
        source_job_id: 'abc123',
        company_name: 'Datadog',
        title: 'Product Management Intern',
        location_text: 'New York, NY, United States',
        canonical_apply_url: 'https://jobright.ai/jobs/info/abc123',
        source_url: 'https://jobright.ai/jobs/info/abc123',
        apply_url: 'https://jobright.ai/jobs/info/abc123',
        posted_at: '2026-09-16T00:00:00.000Z',
        status: 'ACTIVE',
        resolution_status: 'NOT_ATTEMPTED',
        resolution_attempt_count: 0,
        resolution_last_attempt_at: null,
      },
    );
    const supabase = fakeSupabase(store);

    const summary = await runOfficialPostingResolution(
      supabase,
      { jobrightSourceIds: ['bbbbbbbb-0000-4000-8000-000000000002'], atsSourceIds: ['aaaaaaaa-0000-4000-8000-000000000001'] },
      { retryAfterMs: 1000, maxCount: 10, now: new Date('2026-09-18T00:00:00.000Z') },
    );

    expect(summary.mergedIntoAts).toBe(1);
    expect(mockedTavilySearch).not.toHaveBeenCalled();
    const jobrightRow = store.tables.job_catalog.find((r) => r.id === 'jobright-1')!;
    expect(jobrightRow.status).toBe('MERGED');
  });

  it('20/19. falls back to Strategy B when no catalog match exists: canonical_apply_url becomes the resolved employer URL, source_url stays the Jobright detail page', async () => {
    const store = new FakeStore();
    function sourceRow(overrides: Partial<FakeRow> & { id: string }): FakeRow {
      return {
        company_name: 'placeholder',
        source_type: 'JOBRIGHT_GITHUB',
        source_identifier: 'placeholder',
        careers_url: null,
        enabled: true,
        crawl_interval_hours: 24,
        last_crawled_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error: null,
        consecutive_failures: 0,
        etag: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }
    store.tables.job_sources.push(
      sourceRow({
        id: 'cccccccc-0000-4000-8000-000000000003',
        source_identifier: 'jobright-ai/2026-Product-Management-Internship',
      }),
    );
    store.tables.job_catalog.push({
      id: 'jobright-2',
      source_id: 'cccccccc-0000-4000-8000-000000000003',
      source_job_id: 'def456',
      company_name: 'Databricks',
      title: 'Product Management Intern (Summer 2027)',
      location_text: 'San Francisco, CA',
      canonical_apply_url: 'https://jobright.ai/jobs/info/def456',
      source_url: 'https://jobright.ai/jobs/info/def456',
      apply_url: 'https://jobright.ai/jobs/info/def456',
      posted_at: '2026-09-16T00:00:00.000Z',
      status: 'ACTIVE',
      resolution_status: 'NOT_ATTEMPTED',
      resolution_attempt_count: 0,
      resolution_last_attempt_at: null,
    });
    const supabase = fakeSupabase(store);

    mockedTavilySearch.mockResolvedValue({
      status: 'ok',
      results: [
        {
          url: 'https://boards.greenhouse.io/databricks/jobs/9999',
          title: 'Product Management Intern (Summer 2027) - Databricks',
          content: 'Databricks is hiring a Product Management Intern for Summer 2027 in San Francisco, CA.',
          publishedDate: null,
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => DATABRICKS_PAGE }));

    const summary = await runOfficialPostingResolution(
      supabase,
      { jobrightSourceIds: ['cccccccc-0000-4000-8000-000000000003'], atsSourceIds: [] },
      { retryAfterMs: 1000, maxCount: 10, now: new Date('2026-09-18T00:00:00.000Z') },
    );

    expect(summary.resolvedHighConfidence).toBe(1);
    const row = store.tables.job_catalog.find((r) => r.id === 'jobright-2')!;
    expect(row.canonical_apply_url).toBe('https://boards.greenhouse.io/databricks/jobs/9999');
    expect(row.source_url).toBe('https://jobright.ai/jobs/info/def456');
    expect(row.resolution_strategy).toBe('SEARCH');
    vi.unstubAllGlobals();
  });
});
