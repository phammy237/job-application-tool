import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  listOwnApplicationsWithWorkingResumeVersion,
  listOwnSubmittedApplicationsForResumeVersions,
} from './resume-version-usage';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';

describe('listOwnApplicationsWithWorkingResumeVersion', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await listOwnApplicationsWithWorkingResumeVersion(
      supabase,
      USER_ID,
      [],
    );
    expect(result.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('groups applications by working_resume_version_id in one batched query', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'app-1',
          company: 'Acme',
          title: 'Engineer',
          working_resume_version_id: VERSION_ID,
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationsWithWorkingResumeVersion(supabase, USER_ID, [
      VERSION_ID,
    ]);
    expect(result.get(VERSION_ID)).toEqual([
      { id: 'app-1', company: 'Acme', title: 'Engineer' },
    ]);
  });

  it('omits a version with no application currently pointing at it', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationsWithWorkingResumeVersion(supabase, USER_ID, [
      VERSION_ID,
    ]);
    expect(result.has(VERSION_ID)).toBe(false);
  });
});

describe('listOwnSubmittedApplicationsForResumeVersions', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await listOwnSubmittedApplicationsForResumeVersions(
      supabase,
      USER_ID,
      [],
    );
    expect(result.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('groups submission packets by resume_version_id in one batched query', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'packet-1',
          application_id: 'app-1',
          resume_version_id: VERSION_ID,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnSubmittedApplicationsForResumeVersions(
      supabase,
      USER_ID,
      [VERSION_ID],
    );
    expect(result.get(VERSION_ID)).toEqual([
      {
        applicationId: 'app-1',
        packetId: 'packet-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });
});
