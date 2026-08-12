import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { recordOwnGeneratedAnswerDecision } from './generated-answers';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const ANSWER_ID = '55555555-5555-4555-8555-555555555555';

function buildChain(finalResult: { data: unknown; error: null }) {
  const eq = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = eq.mockImplementation(() => chain);
  chain.or = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(finalResult);
  return { chain, eq };
}

describe('recordOwnGeneratedAnswerDecision', () => {
  it('scopes the update by id, user_id, AND job_id — a same-user answer from a different job must not be reachable', async () => {
    const { chain, eq } = buildChain({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await recordOwnGeneratedAnswerDecision(supabase, USER_ID, ANSWER_ID, {
      applicationId: APPLICATION_ID,
      jobId: JOB_ID,
      decision: 'APPROVED',
      finalText: null,
    });

    expect(eq).toHaveBeenCalledWith('id', ANSWER_ID);
    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('job_id', JOB_ID);
  });

  it('returns null (not an error) when no row matches the full scope — never distinguishes "wrong job" from "wrong user" to the caller', async () => {
    const { chain } = buildChain({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await recordOwnGeneratedAnswerDecision(supabase, USER_ID, ANSWER_ID, {
      applicationId: APPLICATION_ID,
      jobId: JOB_ID,
      decision: 'APPROVED',
      finalText: null,
    });

    expect(result).toBeNull();
  });

  it('never copies the original answer into finalText for an unedited APPROVED decision', async () => {
    const { chain } = buildChain({
      data: {
        id: ANSWER_ID,
        user_id: USER_ID,
        application_id: APPLICATION_ID,
        job_id: JOB_ID,
        field_label: 'Full Name',
        field_classification: 'BASIC_PROFILE',
        answer: 'Jane Doe',
        confidence: 0.9,
        source_fact_ids: [],
        reasoning_summary: null,
        unsupported_claims: [],
        requires_user_review: true,
        user_decision: 'APPROVED',
        final_text: null,
        insufficient_data: null,
        rejection_reason: null,
        available_fact_ids: null,
        generation_run_id: null,
        attempt_number: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await recordOwnGeneratedAnswerDecision(supabase, USER_ID, ANSWER_ID, {
      applicationId: APPLICATION_ID,
      jobId: JOB_ID,
      decision: 'APPROVED',
      finalText: null,
    });

    expect(result?.userDecision).toBe('APPROVED');
    expect(result?.finalText).toBeNull();
    expect(result?.answer).toBe('Jane Doe');
  });
});
