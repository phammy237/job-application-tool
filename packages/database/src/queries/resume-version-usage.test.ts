import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  isOwnResumeWorkingForOtherApplication,
  listOwnApplicationsWithWorkingResumeVersion,
  listOwnSubmittedApplicationsForResumeVersions,
} from './resume-version-usage';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const RESUME_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_APPLICATION_ID = '66666666-6666-4666-8666-666666666666';

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

describe('isOwnResumeWorkingForOtherApplication', () => {
  function mockSupabase(versionIds: string[], applicationHits: { id: string }[]) {
    const versionChain: Record<string, unknown> = {};
    versionChain.select = vi.fn(() => versionChain);
    // Two .eq() calls chain to the final promise-returning call on this table.
    let versionEqCalls = 0;
    versionChain.eq = vi.fn(() => {
      versionEqCalls += 1;
      return versionEqCalls < 2 ? versionChain : Promise.resolve({ data: versionIds.map((id) => ({ id })), error: null });
    });

    const appChain: Record<string, unknown> = {};
    appChain.select = vi.fn(() => appChain);
    appChain.eq = vi.fn(() => appChain);
    appChain.neq = vi.fn(() => appChain);
    appChain.in = vi.fn(() => appChain);
    appChain.limit = vi.fn().mockResolvedValue({ data: applicationHits, error: null });

    const from = vi.fn((table: string) => (table === 'resume_versions' ? versionChain : appChain));
    return { from, appChain, versionChain };
  }

  it('returns false without querying applications when the resume has no versions at all', async () => {
    const { from, appChain } = mockSupabase([], []);
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await isOwnResumeWorkingForOtherApplication(
      supabase,
      USER_ID,
      RESUME_ID,
      APPLICATION_ID,
    );
    expect(result).toBe(false);
    expect(appChain.limit).not.toHaveBeenCalled();
  });

  it('returns true when another application currently works from one of this résumé\'s versions', async () => {
    const { from, appChain } = mockSupabase([VERSION_ID], [{ id: OTHER_APPLICATION_ID }]);
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await isOwnResumeWorkingForOtherApplication(
      supabase,
      USER_ID,
      RESUME_ID,
      APPLICATION_ID,
    );
    expect(result).toBe(true);
    expect(appChain.neq).toHaveBeenCalledWith('id', APPLICATION_ID);
    expect(appChain.in).toHaveBeenCalledWith('working_resume_version_id', [VERSION_ID]);
  });

  it('returns false when this application is the sole user of the résumé', async () => {
    const { from } = mockSupabase([VERSION_ID], []);
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await isOwnResumeWorkingForOtherApplication(
      supabase,
      USER_ID,
      RESUME_ID,
      APPLICATION_ID,
    );
    expect(result).toBe(false);
  });
});
