import { describe, expect, it } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { deriveOwnCandidateCompetencyCodes } from './candidate-competency-codes';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const APPROVED = { user_approved: true, approved_for_applications: true, visible_on_public_profile: false };
const UNAPPROVED = { user_approved: false, approved_for_applications: false, visible_on_public_profile: false };

/** Table-keyed fake — every `listOwn*` function this module composes ends in `select('*').eq(...)`
 * (optionally `.order(...)`), so resolving per-table canned rows regardless of the exact chain is
 * sufficient here. */
function fakeSupabase(tables: Record<string, unknown[]>): CareerOsSupabaseClient {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: tables[table] ?? [], error: null });
      return chain;
    },
  } as unknown as CareerOsSupabaseClient;
}

describe('deriveOwnCandidateCompetencyCodes', () => {
  it('matches concepts from an approved skill name', async () => {
    const supabase = fakeSupabase({
      skills: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', user_id: USER_ID, source_fact_id: null, name: 'SQL', category: null, proficiency: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...APPROVED }],
      experiences: [],
      projects: [],
      candidate_facts: [],
      education: [],
    });
    const codes = await deriveOwnCandidateCompetencyCodes(supabase, USER_ID);
    expect(codes).toContain('SQL');
  });

  it('ignores an unapproved skill entirely', async () => {
    const supabase = fakeSupabase({
      skills: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', user_id: USER_ID, source_fact_id: null, name: 'SQL', category: null, proficiency: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...UNAPPROVED }],
      experiences: [],
      projects: [],
      candidate_facts: [],
      education: [],
    });
    const codes = await deriveOwnCandidateCompetencyCodes(supabase, USER_ID);
    expect(codes).not.toContain('SQL');
  });

  it('matches concepts from an approved experience description', async () => {
    const supabase = fakeSupabase({
      skills: [],
      experiences: [
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000002', user_id: USER_ID, source_fact_id: null, company: 'Acme', title: 'PM',
          location: null, employment_type: null, start_date: null, end_date: null,
          description: 'Owned the product roadmap and ran experimentation.', tags: [], display_order: 0,
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...APPROVED,
        },
      ],
      projects: [],
      candidate_facts: [],
      education: [],
    });
    const codes = await deriveOwnCandidateCompetencyCodes(supabase, USER_ID);
    expect(codes).toEqual(expect.arrayContaining(['ROADMAP', 'EXPERIMENTATION']));
  });

  it('returns an empty array when there is no trusted data at all', async () => {
    const supabase = fakeSupabase({
      skills: [], experiences: [], projects: [], candidate_facts: [], education: [],
    });
    expect(await deriveOwnCandidateCompetencyCodes(supabase, USER_ID)).toEqual([]);
  });
});
