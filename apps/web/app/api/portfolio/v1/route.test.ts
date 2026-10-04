import { emptyEvidenceGraph, type EvidenceGraphData, type GraphProject } from '@career-os/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimits } from '../rate-limit';

const getUserId = vi.fn();
const loadGraph = vi.fn();
const getSettings = vi.fn();

vi.mock('@career-os/database', () => ({
  getUserIdForPortfolioApiKey: (...a: unknown[]) => getUserId(...a),
  loadOwnEvidenceGraph: (...a: unknown[]) => loadGraph(...a),
  getOwnPortfolioSettings: (...a: unknown[]) => getSettings(...a),
}));
const admin = { __admin: true };
vi.mock('../../../../lib/supabase/admin', () => ({ createAdminClient: () => admin }));

import { GET } from './route';

const USER = '11111111-1111-4111-8111-111111111111';

const project = (over: Partial<GraphProject>): GraphProject => ({
  id: 'p',
  name: 'P',
  description: null,
  summary: null,
  role: null,
  startDate: null,
  endDate: null,
  url: null,
  tags: [],
  status: null,
  collaborators: [],
  talkingPoints: [],
  origin: 'MANUAL',
  visibility: 'PRIVATE',
  userApproved: true,
  approvedForApplications: true,
  ...over,
});

const graph: EvidenceGraphData = {
  ...emptyEvidenceGraph(),
  projects: [
    project({ id: 'pub', name: 'Public Project', visibility: 'PUBLIC' }),
    project({ id: 'priv', name: 'SECRET-PRIVATE', visibility: 'PRIVATE' }),
    project({ id: 'cos', name: 'SECRET-CAREEROS', visibility: 'CAREER_OS_ONLY' }),
    project({ id: 'unapproved', name: 'SECRET-UNAPPROVED', visibility: 'PUBLIC', userApproved: false }),
  ],
};

function req(headers: Record<string, string> = {}, url = 'http://localhost/api/portfolio/v1'): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  getUserId.mockResolvedValue(USER);
  loadGraph.mockResolvedValue(graph);
  getSettings.mockResolvedValue({ userId: USER, enabled: true, hasApiKey: true, displayName: 'Ada', headline: 'Builder' });
});

describe('GET /api/portfolio/v1', () => {
  it('returns an identical 401 for missing, malformed, unknown and disabled keys', async () => {
    getUserId.mockResolvedValue(null);
    const cases = [
      req(),
      req({ authorization: 'Basic abc' }),
      req({ authorization: 'Bearer' }),
      req({ authorization: 'Bearer cos_pub_unknown' }),
    ];
    const bodies: string[] = [];
    for (const c of cases) {
      const res = await GET(c);
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(loadGraph).not.toHaveBeenCalled();
  });

  it('treats a key whose settings are disabled at read time as unauthorized', async () => {
    getSettings.mockResolvedValue({ userId: USER, enabled: false, hasApiKey: true, displayName: null, headline: null });
    const unknown = await (async () => {
      getUserId.mockResolvedValueOnce(null);
      return GET(req({ authorization: 'Bearer cos_pub_x' }));
    })();
    const disabled = await GET(req({ authorization: 'Bearer cos_pub_y' }));
    expect(disabled.status).toBe(401);
    expect(await disabled.text()).toBe(await unknown.text());
  });

  it('returns only PUBLIC + approved data, scoped to the key-derived user', async () => {
    const res = await GET(req({ authorization: 'Bearer cos_pub_good' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.schemaVersion).toBe('myos.portfolio.v1');
    expect(body.profile).toEqual({ displayName: 'Ada', headline: 'Builder' });
    expect(body.projects.map((p: { name: string }) => p.name)).toEqual(['Public Project']);
    expect(text).not.toContain('SECRET');
    expect(getUserId).toHaveBeenCalledWith(admin, 'cos_pub_good');
    expect(loadGraph).toHaveBeenCalledWith(admin, USER);
    expect(getSettings).toHaveBeenCalledWith(admin, USER);
  });

  it('never takes the user id from query or headers', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    await GET(
      req(
        { authorization: 'Bearer cos_pub_good', 'x-user-id': other },
        `http://localhost/api/portfolio/v1?user_id=${other}&userId=${other}`,
      ),
    );
    expect(loadGraph).toHaveBeenCalledWith(admin, USER);
    expect(loadGraph).not.toHaveBeenCalledWith(admin, other);
  });

  it('returns a generic 500 without leaking details when the backend fails', async () => {
    loadGraph.mockRejectedValue(new Error('db password leaked'));
    const res = await GET(req({ authorization: 'Bearer cos_pub_good' }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('password');
  });

  it('rate limits repeated requests from the same key and IP', async () => {
    const h = { authorization: 'Bearer cos_pub_good', 'x-forwarded-for': '9.9.9.9' };
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await GET(req(h))).status;
    expect(last).toBe(429);
  });
});
