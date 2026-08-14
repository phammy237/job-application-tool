import { describe, expect, it } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { listOwnApprovedFactsForGeneration } from './generation-facts';

type FakeRows = Record<string, Record<string, unknown>[]>;

/**
 * A minimal thenable chain that mimics the subset of PostgrestFilterBuilder this query module
 * calls (.from().select().eq().eq().eq()), resolving to whatever rows were seeded for that
 * table — regardless of which/how many .eq() filters were chained. Good enough to prove the
 * fan-out mapping logic without a real Supabase connection.
 */
function fakeSupabase(rowsByTable: FakeRows): CareerOsSupabaseClient {
  const chainFor = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rowsByTable[table] ?? [], error: null }),
    };
    return chain;
  };
  return {
    from: (table: string) => chainFor(table),
  } as unknown as CareerOsSupabaseClient;
}

const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('listOwnApprovedFactsForGeneration', () => {
  it('maps rows from all five tables into the common shape', async () => {
    const supabase = fakeSupabase({
      candidate_facts: [
        {
          id: 'fact-1',
          category: 'CERTIFICATION',
          title: 'AWS Certified',
          normalized_value: 'AWS Certified Solutions Architect',
          tags: ['aws', 'cloud'],
        },
      ],
      experiences: [
        {
          id: 'exp-1',
          title: 'Backend Engineer',
          company: 'Acme',
          description: 'Built the payments service.',
          tags: ['backend'],
          start_date: '2023-01-01',
          end_date: null,
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      education: [
        {
          id: 'edu-1',
          school: 'UF',
          degree: 'BS',
          field_of_study: 'Computer Science',
          start_date: '2020-08-01',
          graduation_date: '2024-05-01',
        },
      ],
      projects: [
        {
          id: 'proj-1',
          name: 'Career OS',
          role: 'Solo builder',
          description: 'A job application tool.',
          tags: ['typescript'],
          start_date: '2026-01-01',
          end_date: null,
        },
      ],
      skills: [{ id: 'skill-1', name: 'TypeScript', category: 'SKILL' }],
    });

    const facts = await listOwnApprovedFactsForGeneration(supabase, USER_ID);

    expect(facts).toHaveLength(5);
    expect(facts.map((f) => f.sourceTable).sort()).toEqual(
      ['candidate_facts', 'education', 'experiences', 'projects', 'skills'].sort(),
    );

    const experience = facts.find((f) => f.sourceTable === 'experiences');
    expect(experience?.text).toContain('Backend Engineer');
    expect(experience?.text).toContain('Acme');
    expect(experience?.recencyDate).toBe('2023-01-01'); // ongoing: end_date null falls back to start_date
    expect(experience?.isOngoing).toBe(true);
    expect(experience?.category).toBe('EXPERIENCE');
    expect(experience?.updatedAt).toBe('2026-06-01T00:00:00.000Z');

    const education = facts.find((f) => f.sourceTable === 'education');
    expect(education?.recencyDate).toBe('2024-05-01'); // graduation_date preferred over start_date
    expect(education?.isOngoing).toBe(false); // graduation_date is set — not ongoing
  });

  it('returns an empty array when the user has no approved facts in any table', async () => {
    const supabase = fakeSupabase({});
    const facts = await listOwnApprovedFactsForGeneration(supabase, USER_ID);
    expect(facts).toEqual([]);
  });
});
