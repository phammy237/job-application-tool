import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { listCurrentOwnRequirementMappings, promoteOwnRequirementMappingRun } from './requirement-evidence-mappings';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

const FACT_VALID = 'aaaaaaaa-0000-4000-8000-000000000001';
const FACT_CHANGED = 'aaaaaaaa-0000-4000-8000-000000000002';
const FACT_UNAPPROVED = 'aaaaaaaa-0000-4000-8000-000000000003';
const FACT_DELETED = 'aaaaaaaa-0000-4000-8000-000000000004';

const CAPTURED_AT = '2026-01-01T00:00:00.000Z';

const MAPPING_ROW = {
  id: '77777777-7777-4777-8777-777777777777',
  user_id: USER_ID,
  run_id: RUN_ID,
  requirement_text: '5+ years of backend experience',
  requirement_fingerprint: 'fp-1',
  requirement_category: 'EXPERIENCE',
  required_or_preferred: 'REQUIRED',
  relationship: 'DIRECT',
  matched_facts: [
    { factId: FACT_VALID, sourceTable: 'experiences', factUpdatedAt: CAPTURED_AT },
    { factId: FACT_CHANGED, sourceTable: 'experiences', factUpdatedAt: CAPTURED_AT },
    { factId: FACT_UNAPPROVED, sourceTable: 'skills', factUpdatedAt: CAPTURED_AT },
    { factId: FACT_DELETED, sourceTable: 'education', factUpdatedAt: CAPTURED_AT },
  ],
  explanation: 'Matches the Acme backend role.',
  confidence: 0.9,
  requires_user_confirmation: false,
  created_at: CAPTURED_AT,
};

/** Routes .from(table) to per-table fixture rows; mappings table uses the mappings-select chain,
 * everything else uses the fact-lookup chain (select/eq/in). */
function fakeSupabase() {
  const mappingsChain: Record<string, unknown> = {};
  mappingsChain.select = vi.fn(() => mappingsChain);
  mappingsChain.eq = vi.fn(() => mappingsChain);
  mappingsChain.order = vi.fn().mockResolvedValue({ data: [MAPPING_ROW], error: null });

  const factRowsByTable: Record<string, unknown[]> = {
    experiences: [
      { id: FACT_VALID, updated_at: CAPTURED_AT, user_approved: true, approved_for_applications: true },
      {
        id: FACT_CHANGED,
        updated_at: '2026-02-01T00:00:00.000Z', // edited since generation
        user_approved: true,
        approved_for_applications: true,
      },
    ],
    skills: [
      { id: FACT_UNAPPROVED, updated_at: CAPTURED_AT, user_approved: true, approved_for_applications: false },
    ],
    education: [], // FACT_DELETED intentionally absent
    candidate_facts: [],
    projects: [],
  };

  function factChain(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({ data: factRowsByTable[table] ?? [], error: null });
    return chain;
  }

  const from = vi.fn((table: string) => (table === 'requirement_evidence_mappings' ? mappingsChain : factChain(table)));
  return { from } as unknown as CareerOsSupabaseClient;
}

describe('listCurrentOwnRequirementMappings', () => {
  it('resolves all four evidence-validity states distinctly, never collapsing them', async () => {
    const supabase = fakeSupabase();
    const [mapping] = await listCurrentOwnRequirementMappings(supabase, USER_ID, RUN_ID);

    const byId = new Map(mapping!.matchedFacts.map((f) => [f.factId, f.validity]));
    expect(byId.get(FACT_VALID)).toBe('valid');
    expect(byId.get(FACT_CHANGED)).toBe('changed_since_analysis');
    expect(byId.get(FACT_UNAPPROVED)).toBe('unapproved');
    expect(byId.get(FACT_DELETED)).toBe('deleted');
  });

  it('never queries a fact-source table that no mapping actually references', async () => {
    const supabase = fakeSupabase();
    await listCurrentOwnRequirementMappings(supabase, USER_ID, RUN_ID);
    const calledTables = (supabase.from as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (call) => call[0],
    );
    // projects and candidate_facts are never referenced by MAPPING_ROW's matched_facts.
    expect(calledTables).not.toContain('projects');
    expect(calledTables).not.toContain('candidate_facts');
  });
});

describe('promoteOwnRequirementMappingRun', () => {
  it('calls the server-only promotion RPC and returns the mapping count', async () => {
    const single = vi.fn().mockResolvedValue({ data: { run_id: RUN_ID, mapping_count: 3 }, error: null });
    const rpc = vi.fn(() => ({ single }));
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await promoteOwnRequirementMappingRun(supabase, USER_ID, RUN_ID, []);

    expect(rpc).toHaveBeenCalledWith(
      'promote_requirement_mapping_run',
      expect.objectContaining({ p_user_id: USER_ID, p_run_id: RUN_ID }),
    );
    expect(result).toEqual({ runId: RUN_ID, mappingCount: 3 });
  });
});
