import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOwnJobSnapshot } from './job-snapshots';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

const BASE_ROW = {
  id: SNAPSHOT_ID,
  user_id: USER_ID,
  source_job_id: '33333333-3333-4333-8333-333333333333',
  company: 'Acme',
  title: 'Backend Engineer',
  location: 'Remote',
  employment_type: 'Full-time',
  source_url: 'https://boards.example.com/job/123',
  external_id: null,
  description: 'Build things.',
  required_qualifications: ['5 years of Python'],
  preferred_qualifications: [],
  responsibilities: [],
  skills: ['Python'],
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  locations: ['Remote'],
  work_mode: 'REMOTE',
  remote_location_restrictions: null,
  work_authorization_language: null,
  source_type: 'GENERIC',
  content_fingerprint: 'v1:abc123',
  content_truncated: false,
  truncated_fields: [],
  captured_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

function fakeSupabase(row: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
}

describe('getOwnJobSnapshot', () => {
  it('parses a full snapshot row, scoped by both id and user_id', async () => {
    const supabase = fakeSupabase(BASE_ROW);
    const result = await getOwnJobSnapshot(supabase, USER_ID, SNAPSHOT_ID);
    expect(result?.id).toBe(SNAPSHOT_ID);
    expect(result?.contentFingerprint).toBe('v1:abc123');
    expect(result?.requiredQualifications).toEqual(['5 years of Python']);
  });

  it('returns null when no snapshot is found', async () => {
    const supabase = fakeSupabase(null);
    const result = await getOwnJobSnapshot(supabase, USER_ID, SNAPSHOT_ID);
    expect(result).toBeNull();
  });
});
