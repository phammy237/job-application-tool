import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  markAchievementVerifiedIfSupported,
  createOwnAchievement,
} from './myos-achievements';
import { acceptOwnCandidate, createOwnCandidatesIdempotent } from './myos-candidates';
import { createOwnEdge, listOwnEdges, replaceOwnEdgesFrom } from './myos-edges';
import { upsertOwnEvidenceBySource } from './myos-evidence';
import { loadOwnEvidenceGraph } from './myos-graph';
import {
  getGithubAccessToken,
  getOwnGithubConnection,
  saveGithubAccessToken,
  upsertGithubRepositorySnapshot,
} from './myos-github';
import {
  getOwnPortfolioSettings,
  getUserIdForPortfolioApiKey,
  rotateOwnPortfolioApiKey,
} from './myos-portfolio';

const USER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const EVIDENCE = '44444444-4444-4444-8444-444444444444';
const ACH = '55555555-5555-4555-8555-555555555555';
const SKILL = '66666666-6666-4666-8666-666666666666';
const EDGE = '77777777-7777-4777-8777-777777777777';
const TS = '2026-01-01T00:00:00.000Z';

type Op = [string, unknown[]];
interface Call {
  table: string;
  ops: Op[];
}
type Respond = (call: Call) => { data: unknown; error: unknown };

function has(call: Call, name: string): boolean {
  return call.ops.some(([n]) => n === name);
}
function args(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([n]) => n === name)?.[1];
}

/** Thenable chain that records every builder call and answers via `respond`. */
function makeClient(respond: Respond) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of [
        'select',
        'insert',
        'update',
        'upsert',
        'delete',
        'eq',
        'in',
        'or',
        'order',
        'limit',
        'single',
        'maybeSingle',
      ]) {
        chain[name] = (...a: unknown[]) => {
          call.ops.push([name, a]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(respond(call)).then(resolve, reject);
      return chain;
    },
  };
  return { client: client as unknown as CareerOsSupabaseClient, calls };
}

const ok = (data: unknown) => ({ data, error: null });

const evidenceRow = (over: Record<string, unknown> = {}) => ({
  id: EVIDENCE,
  user_id: USER,
  source_type: 'GITHUB_REPO',
  source_ref: 'o/r',
  source_url: null,
  title: 'o/r',
  excerpt: null,
  occurred_at: null,
  confidence: null,
  verification_state: 'VERIFIED',
  visibility: 'CAREER_OS_ONLY',
  metadata: {},
  created_at: TS,
  updated_at: TS,
  ...over,
});

const achievementRow = (over: Record<string, unknown> = {}) => ({
  id: ACH,
  user_id: USER,
  title: 'Faster builds',
  description: null,
  kind: 'METRIC',
  occurred_on: null,
  metric_text: '30% faster',
  project_id: null,
  experience_id: null,
  verification_state: 'USER_PROVIDED',
  user_approved: false,
  visibility: 'PRIVATE',
  created_at: TS,
  updated_at: TS,
  ...over,
});

const edgeRow = (over: Record<string, unknown> = {}) => ({
  id: EDGE,
  user_id: USER,
  from_type: 'PROJECT',
  from_id: PROJECT,
  to_type: 'SKILL',
  to_id: SKILL,
  relation: 'DEMONSTRATES',
  verification_state: 'USER_PROVIDED',
  confidence: null,
  note: null,
  created_at: TS,
  ...over,
});

function expectUserScoped(calls: Call[], opts: { except?: string[] } = {}) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    if (opts.except?.includes(call.table)) continue;
    if (has(call, 'insert') && !has(call, 'select')) continue;
    const scoped = call.ops.some(
      ([n, a]) => n === 'eq' && a[0] === 'user_id' && a[1] === USER,
    );
    const insertsOwnRow = has(call, 'insert') || has(call, 'upsert');
    expect(scoped || insertsOwnRow, `${call.table} call lacks user_id filter`).toBe(true);
  }
}

describe('myos-evidence upsertOwnEvidenceBySource', () => {
  const input = {
    sourceType: 'GITHUB_REPO' as const,
    sourceRef: 'o/r',
    title: 'o/r',
    verificationState: 'INFERRED' as const,
  };

  it('never downgrades VERIFIED on re-sync and does not touch visibility', async () => {
    const { client, calls } = makeClient((c) => {
      if (has(c, 'update')) return ok(evidenceRow());
      return ok(evidenceRow({ verification_state: 'VERIFIED' }));
    });
    await upsertOwnEvidenceBySource(client, USER, input);
    const update = calls.find((c) => has(c, 'update'))!;
    const payload = args(update, 'update')![0] as Record<string, unknown>;
    expect(payload.verification_state).toBe('VERIFIED');
    expect('visibility' in payload).toBe(false);
    expect(calls.some((c) => has(c, 'insert'))).toBe(false);
    expectUserScoped(calls);
  });

  it('upgrades to a stronger state', async () => {
    const { client, calls } = makeClient((c) =>
      ok(evidenceRow({ verification_state: has(c, 'update') ? 'VERIFIED' : 'INFERRED' })),
    );
    await upsertOwnEvidenceBySource(client, USER, {
      ...input,
      verificationState: 'VERIFIED',
    });
    const payload = args(
      calls.find((c) => has(c, 'update'))!,
      'update',
    )![0] as Record<string, unknown>;
    expect(payload.verification_state).toBe('VERIFIED');
  });

  it('inserts with an explicit user_id when no row exists yet', async () => {
    const { client, calls } = makeClient((c) =>
      has(c, 'insert') ? ok(evidenceRow()) : ok(null),
    );
    await upsertOwnEvidenceBySource(client, USER, input);
    const payload = args(
      calls.find((c) => has(c, 'insert'))!,
      'insert',
    )![0] as Record<string, unknown>;
    expect(payload.user_id).toBe(USER);
  });
});

describe('myos-achievements verification rules', () => {
  it('forces a metric achievement from VERIFIED to USER_PROVIDED on create', async () => {
    const { client, calls } = makeClient(() => ok(achievementRow()));
    await createOwnAchievement(client, USER, {
      title: 'Faster builds',
      metricText: '30% faster',
      verificationState: 'VERIFIED',
    });
    const payload = args(calls[0]!, 'insert')![0] as Record<string, unknown>;
    expect(payload.verification_state).toBe('USER_PROVIDED');
    expect(payload.user_id).toBe(USER);
  });

  it('allows VERIFIED on create when there is no metric', async () => {
    const { client, calls } = makeClient(() => ok(achievementRow({ metric_text: null })));
    await createOwnAchievement(client, USER, {
      title: 'Award',
      verificationState: 'VERIFIED',
    });
    const payload = args(calls[0]!, 'insert')![0] as Record<string, unknown>;
    expect(payload.verification_state).toBe('VERIFIED');
  });

  it('markAchievementVerifiedIfSupported does nothing without a SUPPORTS edge', async () => {
    const { client, calls } = makeClient(() => ok([]));
    const result = await markAchievementVerifiedIfSupported(client, USER, ACH);
    expect(result).toBeNull();
    expect(calls.some((c) => has(c, 'update'))).toBe(false);
    expectUserScoped(calls);
  });

  it('markAchievementVerifiedIfSupported verifies when supporting evidence exists', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'myos_edges') return ok([{ from_id: EVIDENCE }]);
      if (c.table === 'myos_evidence') return ok([{ id: EVIDENCE }]);
      return ok(achievementRow({ verification_state: 'VERIFIED' }));
    });
    const result = await markAchievementVerifiedIfSupported(client, USER, ACH);
    expect(result?.verificationState).toBe('VERIFIED');
    expectUserScoped(calls);
  });
});

describe('myos-edges', () => {
  it('createOwnEdge is idempotent: returns the existing edge without inserting', async () => {
    const { client, calls } = makeClient(() => ok(edgeRow()));
    const edge = await createOwnEdge(client, USER, {
      fromType: 'PROJECT',
      fromId: PROJECT,
      toType: 'SKILL',
      toId: SKILL,
      relation: 'DEMONSTRATES',
      verificationState: 'USER_PROVIDED',
    });
    expect(edge.id).toBe(EDGE);
    expect(calls.some((c) => has(c, 'insert'))).toBe(false);
    expectUserScoped(calls);
  });

  it('createOwnEdge recovers from a unique violation by returning the winner', async () => {
    let lookups = 0;
    const { client } = makeClient((c) => {
      if (has(c, 'insert'))
        return { data: null, error: { message: 'dup', code: '23505' } };
      lookups += 1;
      return ok(lookups === 1 ? null : edgeRow());
    });
    const edge = await createOwnEdge(client, USER, {
      fromType: 'PROJECT',
      fromId: PROJECT,
      toType: 'SKILL',
      toId: SKILL,
      relation: 'DEMONSTRATES',
      verificationState: 'USER_PROVIDED',
    });
    expect(edge.id).toBe(EDGE);
  });

  it('listOwnEdges with a node filter is still user-scoped', async () => {
    const { client, calls } = makeClient(() => ok([edgeRow()]));
    await listOwnEdges(client, USER, { nodeType: 'PROJECT', nodeId: PROJECT });
    expectUserScoped(calls);
    expect(has(calls[0]!, 'or')).toBe(true);
  });

  it('replaceOwnEdgesFrom deletes only stale targets, scoped to the user', async () => {
    const stale = '88888888-8888-4888-8888-888888888888';
    const { client, calls } = makeClient((c) => {
      if (has(c, 'delete')) return ok(null);
      if (has(c, 'maybeSingle')) return ok(edgeRow());
      return ok([
        edgeRow(),
        edgeRow({ id: stale, to_id: '99999999-9999-4999-8999-999999999999' }),
      ]);
    });
    await replaceOwnEdgesFrom(client, USER, {
      fromType: 'PROJECT',
      fromId: PROJECT,
      relation: 'DEMONSTRATES',
      toType: 'SKILL',
      targets: [{ toId: SKILL, verificationState: 'USER_PROVIDED' }],
    });
    const del = calls.find((c) => has(c, 'delete'))!;
    expect(args(del, 'in')).toEqual(['id', [stale]]);
    expectUserScoped(calls);
  });
});

describe('myos-candidates', () => {
  const skillInput = (key: string) => ({
    projectId: PROJECT,
    payload: { kind: 'SKILL' as const, skill: 'FastAPI', category: null },
    dedupeKey: key,
  });

  it('skips existing dedupe keys and in-batch duplicates', async () => {
    const { client, calls } = makeClient((c) => {
      if (has(c, 'insert')) return ok(null);
      return ok([{ dedupe_key: 'old' }]);
    });
    const result = await createOwnCandidatesIdempotent(client, USER, [
      skillInput('old'),
      skillInput('new'),
      skillInput('new'),
    ]);
    expect(result).toEqual({ created: 1, skipped: 2 });
    const rows = args(
      calls.find((c) => has(c, 'insert'))!,
      'insert',
    )![0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(USER);
    expect(rows[0]!.payload).toEqual({ skill: 'FastAPI', category: null });
  });

  it('inserts nothing when everything already exists', async () => {
    const { client, calls } = makeClient(() => ok([{ dedupe_key: 'old' }]));
    const result = await createOwnCandidatesIdempotent(client, USER, [skillInput('old')]);
    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(calls.some((c) => has(c, 'insert'))).toBe(false);
  });

  it('accepting a SKILL candidate creates the skill unapproved-for-applications', async () => {
    const candidate = {
      id: '12121212-1212-4212-8212-121212121212',
      user_id: USER,
      kind: 'SKILL',
      project_id: PROJECT,
      payload: { skill: 'FastAPI', category: 'FRAMEWORK' },
      evidence_ids: [],
      rationale: null,
      dedupe_key: 'k',
      status: 'PENDING',
      created_at: TS,
      decided_at: null,
    };
    const { client, calls } = makeClient((c) => {
      if (c.table === 'myos_candidates') {
        return ok(
          has(c, 'update')
            ? { ...candidate, status: 'ACCEPTED', decided_at: TS }
            : candidate,
        );
      }
      if (c.table === 'skills') return has(c, 'insert') ? ok({ id: SKILL }) : ok([]);
      if (c.table === 'myos_edges') return ok(has(c, 'insert') ? edgeRow() : null);
      return ok(null);
    });
    const result = await acceptOwnCandidate(client, USER, candidate.id);
    expect(result.status).toBe('ACCEPTED');
    const skillInsert = args(
      calls.find((c) => c.table === 'skills' && has(c, 'insert'))!,
      'insert',
    )![0] as Record<string, unknown>;
    expect(skillInsert).toMatchObject({
      user_id: USER,
      user_approved: true,
      approved_for_applications: false,
    });
    const edgeInsert = args(
      calls.find((c) => c.table === 'myos_edges' && has(c, 'insert'))!,
      'insert',
    )![0] as Record<string, unknown>;
    expect(edgeInsert).toMatchObject({
      relation: 'DEMONSTRATES',
      verification_state: 'USER_PROVIDED',
    });
  });
});

describe('myos-github', () => {
  const snapshot = {
    githubRepoId: 1,
    fullName: 'o/r',
    description: null,
    htmlUrl: 'https://github.com/o/r',
    isPrivate: false,
    isFork: false,
    isArchived: false,
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    languages: { TypeScript: 10 },
    topics: [],
    stars: 1,
    repoCreatedAt: null,
    pushedAt: null,
    readmeExcerpt: null,
    readmeSha: null,
    contributors: [],
    prCount: 0,
    commitCount: 0,
    etag: null,
  };
  const repoRow = {
    id: EVIDENCE,
    user_id: USER,
    github_repo_id: 1,
    full_name: 'o/r',
    description: null,
    html_url: 'https://github.com/o/r',
    is_private: false,
    is_fork: false,
    is_archived: false,
    default_branch: 'main',
    primary_language: null,
    languages: {},
    topics: [],
    stars: 1,
    repo_created_at: null,
    pushed_at: null,
    readme_excerpt: null,
    readme_sha: null,
    contributors: [],
    pr_count: 0,
    commit_count: 0,
    etag: null,
    selected: true,
    project_id: PROJECT,
    sync_status: 'SYNCED',
    sync_error: null,
    last_synced_at: null,
    created_at: TS,
    updated_at: TS,
  };

  it('re-sync never writes selected or project_id', async () => {
    const { client, calls } = makeClient((c) =>
      ok(has(c, 'update') ? repoRow : { id: EVIDENCE }),
    );
    const repo = await upsertGithubRepositorySnapshot(client, USER, snapshot);
    const payload = args(
      calls.find((c) => has(c, 'update'))!,
      'update',
    )![0] as Record<string, unknown>;
    expect('selected' in payload).toBe(false);
    expect('project_id' in payload).toBe(false);
    expect(repo.selected).toBe(true);
    expectUserScoped(calls);
  });

  it('first sync inserts as not selected (default) with explicit user_id', async () => {
    const { client, calls } = makeClient((c) =>
      has(c, 'insert') ? ok({ ...repoRow, selected: false, project_id: null }) : ok(null),
    );
    await upsertGithubRepositorySnapshot(client, USER, snapshot);
    const payload = args(
      calls.find((c) => has(c, 'insert'))!,
      'insert',
    )![0] as Record<string, unknown>;
    expect(payload.user_id).toBe(USER);
    expect('selected' in payload).toBe(false);
  });

  it('connection objects never carry token material', async () => {
    const { client } = makeClient(() =>
      ok({
        user_id: USER,
        github_login: 'octo',
        github_user_id: 5,
        has_token: true,
        status: 'CONNECTED',
        last_error: null,
        last_synced_at: null,
        created_at: TS,
        updated_at: TS,
        encrypted_access_token: 'SECRET',
      }),
    );
    const conn = await getOwnGithubConnection(client, USER);
    expect(JSON.stringify(conn)).not.toContain('SECRET');
    expect(conn?.hasToken).toBe(true);
  });

  it('saves the token encrypted and reads it back decrypted', async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    let stored = '';
    const { client } = makeClient((c) => {
      if (c.table === 'github_credentials' && has(c, 'upsert')) {
        stored = (args(c, 'upsert')![0] as { encrypted_access_token: string })
          .encrypted_access_token;
        return ok(null);
      }
      if (c.table === 'github_credentials') return ok({ encrypted_access_token: stored });
      return ok(null);
    });
    await saveGithubAccessToken(client, USER, 'ghp_plain_token_value');
    expect(stored).not.toContain('ghp_plain_token_value');
    expect(await getGithubAccessToken(client, USER)).toBe('ghp_plain_token_value');
  });
});

describe('myos-portfolio', () => {
  it('settings expose hasApiKey only, never the hash', async () => {
    const { client } = makeClient(() =>
      ok({
        user_id: USER,
        enabled: true,
        api_key_hash: 'abc123hash',
        display_name: 'A',
        headline: null,
        created_at: TS,
        updated_at: TS,
      }),
    );
    const settings = await getOwnPortfolioSettings(client, USER);
    expect(settings?.hasApiKey).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('abc123hash');
  });

  it('rotate stores only the SHA-256 hash and returns the plaintext once', async () => {
    const { client, calls } = makeClient(() => ok(null));
    const key = await rotateOwnPortfolioApiKey(client, USER);
    expect(key.startsWith('cos_pub_')).toBe(true);
    const payload = args(calls[0]!, 'upsert')![0] as Record<string, unknown>;
    expect(payload.api_key_hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(payload.user_id).toBe(USER);
  });

  it('resolves a key to a user only through its hash and only when enabled', async () => {
    const key = 'cos_pub_example';
    const { client, calls } = makeClient(() => ok({ user_id: USER }));
    expect(await getUserIdForPortfolioApiKey(client, key)).toBe(USER);
    const eqs = calls[0]!.ops.filter(([n]) => n === 'eq').map(([, a]) => a);
    expect(eqs).toContainEqual([
      'api_key_hash',
      createHash('sha256').update(key).digest('hex'),
    ]);
    expect(eqs).toContainEqual(['enabled', true]);
    expect(JSON.stringify(calls[0])).not.toContain(`"${key}"`);
  });

  it('rejects malformed keys without querying', async () => {
    const { client, calls } = makeClient(() => ok(null));
    expect(await getUserIdForPortfolioApiKey(client, 'nope')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('myos-graph loadOwnEvidenceGraph', () => {
  it('scopes all eight reads to the user and defaults missing visibility to PRIVATE', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'projects')
        return ok([
          {
            id: PROJECT,
            user_id: USER,
            name: 'P',
            description: null,
            role: null,
            start_date: null,
            end_date: null,
            url: null,
            tags: [],
            user_approved: true,
            approved_for_applications: false,
            visible_on_public_profile: false,
          },
        ]);
      return ok([]);
    });
    const graph = await loadOwnEvidenceGraph(client, USER);
    expect(calls).toHaveLength(8);
    expectUserScoped(calls);
    expect(graph.projects[0]).toMatchObject({
      visibility: 'PRIVATE',
      origin: 'MANUAL',
      status: null,
      talkingPoints: [],
    });
  });
});
