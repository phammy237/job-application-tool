import { describe, expect, it } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { updateOwnAchievement } from './myos-achievements';
import { acceptOwnCandidate, isCandidateConflict } from './myos-candidates';
import { updateOwnEvidence, upsertOwnEvidenceBySource } from './myos-evidence';
import { loadPublicEvidenceGraph } from './myos-graph';
import { sanitizeDbText } from './myos-mappers';
import { upsertOwnPortfolioSettings } from './myos-portfolio';

const USER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const EVIDENCE = '44444444-4444-4444-8444-444444444444';
const ACH = '55555555-5555-4555-8555-555555555555';
const CAND = '88888888-8888-4888-8888-888888888888';
const TS = '2026-01-01T00:00:00.000Z';

type Op = [string, unknown[]];
interface Call {
  table: string;
  ops: Op[];
}
type Respond = (call: Call, index: number) => { data: unknown; error: unknown };

const has = (call: Call, name: string) => call.ops.some(([n]) => n === name);
const args = (call: Call, name: string) => call.ops.find(([n]) => n === name)?.[1];

function makeClient(respond: Respond) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      const index = calls.length;
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
        Promise.resolve(respond(call, index)).then(resolve, reject);
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
  visibility: 'PUBLIC',
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
  verification_state: 'VERIFIED',
  user_approved: true,
  visibility: 'PUBLIC',
  created_at: TS,
  updated_at: TS,
  ...over,
});

describe('sanitizeDbText', () => {
  it('strips NUL and lone surrogates but keeps valid pairs and null', () => {
    expect(sanitizeDbText('a\u0000b')).toBe('ab');
    expect(sanitizeDbText('x\uD800y')).toBe('xy');
    expect(sanitizeDbText('x\uDC00y')).toBe('xy');
    expect(sanitizeDbText('ok 😀')).toBe('ok 😀');
    expect(sanitizeDbText(null)).toBeNull();
  });
});

describe('upsertOwnEvidenceBySource hardening', () => {
  const input = {
    sourceType: 'GITHUB_REPO' as const,
    sourceRef: 'o/r',
    title: 'Source Title\u0000',
    verificationState: 'VERIFIED' as const,
  };

  it('does not overwrite a user-edited title on resync and keeps the userEdited flag', async () => {
    const { client, calls } = makeClient((c) =>
      has(c, 'update')
        ? ok(evidenceRow())
        : ok(evidenceRow({ title: 'My wording', metadata: { userEdited: true } })),
    );
    await upsertOwnEvidenceBySource(client, USER, input);
    const payload = args(
      calls.find((c) => has(c, 'update'))!,
      'update',
    )![0] as Record<string, unknown>;
    expect('title' in payload).toBe(false);
    expect('excerpt' in payload).toBe(false);
    expect(payload.metadata).toMatchObject({ userEdited: true });
  });

  it('updates the title from the source when the user never edited it (and sanitizes it)', async () => {
    const { client, calls } = makeClient((c) =>
      ok(evidenceRow({ title: 'old', ...(has(c, 'update') ? {} : {}) })),
    );
    await upsertOwnEvidenceBySource(client, USER, input);
    const payload = args(
      calls.find((c) => has(c, 'update'))!,
      'update',
    )![0] as Record<string, unknown>;
    expect(payload.title).toBe('Source Title');
  });

  it('retries once when a concurrent insert wins (23505)', async () => {
    let finds = 0;
    const { client, calls } = makeClient((c) => {
      if (has(c, 'insert'))
        return { data: null, error: { message: 'dup', code: '23505' } };
      if (has(c, 'update')) return ok(evidenceRow());
      finds += 1;
      return ok(finds === 1 ? null : evidenceRow());
    });
    const result = await upsertOwnEvidenceBySource(client, USER, input);
    expect(result.id).toBe(EVIDENCE);
    expect(calls.some((c) => has(c, 'update'))).toBe(true);
  });
});

describe('updateOwnEvidence', () => {
  it('flags the row as user-edited when the title changes', async () => {
    const { client, calls } = makeClient(() => ok(evidenceRow()));
    await updateOwnEvidence(client, USER, EVIDENCE, { title: 'Mine' });
    const update = calls.find((c) => has(c, 'update'))!;
    expect(
      (args(update, 'update')![0] as Record<string, unknown>).metadata,
    ).toMatchObject({ userEdited: true });
  });
});

describe('updateOwnAchievement metric guard', () => {
  it('downgrades an already VERIFIED achievement when its metric text changes without evidence', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'myos_edges') return ok([]);
      return ok(achievementRow());
    });
    await updateOwnAchievement(client, USER, ACH, { metricText: '90% faster' });
    const update = calls.find(
      (c) => c.table === 'myos_achievements' && has(c, 'update'),
    )!;
    expect(
      (args(update, 'update')![0] as Record<string, unknown>).verification_state,
    ).toBe('USER_PROVIDED');
  });

  it('keeps VERIFIED when a supporting evidence edge exists', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'myos_edges') return ok([{ from_id: EVIDENCE }]);
      if (c.table === 'myos_evidence') return ok([{ id: EVIDENCE }]);
      return ok(achievementRow());
    });
    await updateOwnAchievement(client, USER, ACH, { metricText: '35% faster' });
    const update = calls.find(
      (c) => c.table === 'myos_achievements' && has(c, 'update'),
    )!;
    expect(
      (args(update, 'update')![0] as Record<string, unknown>).verification_state,
    ).toBeUndefined();
  });

  it('does not touch verification state for a metric-free edit', async () => {
    const { client, calls } = makeClient(() => ok(achievementRow()));
    await updateOwnAchievement(client, USER, ACH, { title: 'New title' });
    expect(calls.some((c) => c.table === 'myos_edges')).toBe(false);
  });
});

describe('acceptOwnCandidate PROJECT_SUMMARY conflict', () => {
  const candidate = {
    id: CAND,
    user_id: USER,
    kind: 'PROJECT_SUMMARY',
    project_id: PROJECT,
    payload: { text: 'A new summary' },
    evidence_ids: [],
    rationale: null,
    dedupe_key: 'k',
    status: 'PENDING',
    created_at: TS,
    decided_at: null,
  };

  it('returns a conflict and leaves the candidate PENDING when a summary already exists', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'projects')
        return ok({ summary: 'Existing summary', talking_points: [] });
      return ok(candidate);
    });
    const result = await acceptOwnCandidate(client, USER, CAND);
    expect(isCandidateConflict(result)).toBe(true);
    expect(calls.some((c) => has(c, 'update'))).toBe(false);
  });
});

describe('loadPublicEvidenceGraph', () => {
  it('filters PUBLIC (+ approved) at query level and never queries private node tables', async () => {
    const { client, calls } = makeClient((c) => {
      if (c.table === 'myos_evidence') return ok([evidenceRow()]);
      return ok([]);
    });
    const graph = await loadPublicEvidenceGraph(client, USER);
    const tables = calls.map((c) => c.table).sort();
    expect(tables).toEqual([
      'myos_achievements',
      'myos_edges',
      'myos_evidence',
      'projects',
      'skills',
    ]);
    for (const c of calls) {
      const eqs = c.ops.filter(([n]) => n === 'eq').map(([, a]) => a as unknown[]);
      expect(eqs).toContainEqual(['user_id', USER]);
      if (c.table !== 'myos_edges') expect(eqs).toContainEqual(['visibility', 'PUBLIC']);
      if (['projects', 'skills', 'myos_achievements'].includes(c.table)) {
        expect(eqs).toContainEqual(['user_approved', true]);
      }
    }
    const edgeCall = calls.find((c) => c.table === 'myos_edges')!;
    expect(
      edgeCall.ops.filter(([n]) => n === 'in').map(([, a]) => (a as unknown[])[0]),
    ).toEqual(['from_id', 'to_id']);
    expect(graph.evidence).toHaveLength(1);
    expect(graph.stories).toEqual([]);
    expect(graph.experiences).toEqual([]);
  });

  it('skips the edge query when nothing is public', async () => {
    const { client, calls } = makeClient(() => ok([]));
    const graph = await loadPublicEvidenceGraph(client, USER);
    expect(calls.some((c) => c.table === 'myos_edges')).toBe(false);
    expect(graph.edges).toEqual([]);
  });

  it('drops edges whose endpoints are not both loaded', async () => {
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const edge = (toId: string) => ({
      id: '77777777-7777-4777-8777-777777777777',
      user_id: USER,
      from_type: 'EVIDENCE',
      from_id: EVIDENCE,
      to_type: 'PROJECT',
      to_id: toId,
      relation: 'SUPPORTS',
      verification_state: 'USER_PROVIDED',
      confidence: null,
      note: null,
      created_at: TS,
    });
    const { client } = makeClient((c) => {
      if (c.table === 'myos_evidence') return ok([evidenceRow()]);
      if (c.table === 'myos_edges') return ok([edge(OTHER)]);
      return ok([]);
    });
    const graph = await loadPublicEvidenceGraph(client, USER);
    expect(graph.edges).toEqual([]);
  });
});

describe('upsertOwnPortfolioSettings validation', () => {
  it('strips control characters and rejects over-long public text', async () => {
    const { client, calls } = makeClient(() =>
      ok({
        user_id: USER,
        enabled: true,
        api_key_hash: null,
        display_name: 'Ada B',
        headline: null,
      }),
    );
    await upsertOwnPortfolioSettings(client, USER, {
      enabled: true,
      displayName: 'Ada\u0000\n B',
      headline: '  ',
    });
    const payload = args(calls[0]!, 'upsert')![0] as Record<string, unknown>;
    expect(payload.display_name).toBe('Ada B');
    expect(payload.headline).toBeNull();
    await expect(
      upsertOwnPortfolioSettings(client, USER, {
        enabled: true,
        displayName: 'x'.repeat(81),
        headline: null,
      }),
    ).rejects.toThrow();
    await expect(
      upsertOwnPortfolioSettings(client, USER, {
        enabled: true,
        displayName: null,
        headline: 'x'.repeat(161),
      }),
    ).rejects.toThrow();
  });
});
