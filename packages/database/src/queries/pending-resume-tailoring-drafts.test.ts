import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  createOwnPendingResumeTailoringDraft,
  deleteOwnPendingResumeTailoringDraft,
  getOwnPendingResumeTailoringDraft,
  hasOwnPendingResumeTailoringDraft,
} from './pending-resume-tailoring-drafts';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

const BASE_PROPOSAL = {
  baseResumeVersionId: '55555555-5555-4555-8555-555555555555',
  baseResumeDisplayName: 'Master',
  baseResumeVersionNumber: 1,
  jobSnapshotId: '66666666-6666-4666-8666-666666666666',
  requirementMappingRunId: null,
  baseResume: {
    schemaVersion: 1,
    header: { fullName: 'Ada', email: null, phone: null, location: null, links: {} },
    education: [],
    experience: [],
    projects: [],
    leadership: [],
    skills: [],
    renderOverride: null,
  },
  customLatexOverridePresent: false,
  researchMode: 'JOB_ONLY',
  companyResearchSnapshotId: null,
  companyResearchResearchedAt: null,
  selectedResearchFindingCount: 0,
  operations: [],
  summary: {
    rewrittenBullets: 0,
    addedBullets: 0,
    omittedBullets: 0,
    omittedEntries: 0,
    movedBullets: 0,
    movedEntries: 0,
    skillsReordered: false,
    requirementsReferenced: 0,
    researchFindingsReferenced: 0,
    operationsInfluencedByResearch: 0,
  },
  coverage: {
    totalRequirementCount: 0,
    coveredRequirementIds: [],
    unsupportedRequirementIds: [],
    referencedRequirementIds: [],
    unsupportedRequirements: [],
  },
  proposedResumeLatex: '\\documentclass{article}',
};

describe('hasOwnPendingResumeTailoringDraft', () => {
  it('returns true when a row exists', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'draft-1' }, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    expect(await hasOwnPendingResumeTailoringDraft(supabase, USER_ID, APPLICATION_ID)).toBe(true);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.eq).toHaveBeenCalledWith('application_id', APPLICATION_ID);
  });

  it('returns false when no row exists', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    expect(await hasOwnPendingResumeTailoringDraft(supabase, USER_ID, APPLICATION_ID)).toBe(false);
  });
});

describe('getOwnPendingResumeTailoringDraft', () => {
  it('parses the stored proposal back into a ResumeTailoringProposal', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'draft-1',
        user_id: USER_ID,
        application_id: APPLICATION_ID,
        proposal: BASE_PROPOSAL,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnPendingResumeTailoringDraft(supabase, USER_ID, APPLICATION_ID);
    expect(result?.proposal.baseResumeVersionId).toBe(BASE_PROPOSAL.baseResumeVersionId);
    expect(result?.proposal.jobSnapshotId).toBe(BASE_PROPOSAL.jobSnapshotId);
  });

  it('returns null when no draft exists', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    expect(await getOwnPendingResumeTailoringDraft(supabase, USER_ID, APPLICATION_ID)).toBeNull();
  });
});

describe('createOwnPendingResumeTailoringDraft', () => {
  it('inserts the proposal scoped to user_id and application_id', async () => {
    const chain: Record<string, unknown> = {};
    chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await createOwnPendingResumeTailoringDraft(
      supabase,
      USER_ID,
      APPLICATION_ID,
      BASE_PROPOSAL as never,
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, application_id: APPLICATION_ID }),
    );
  });
});

describe('deleteOwnPendingResumeTailoringDraft', () => {
  it('deletes scoped to user_id and application_id, and never throws when nothing matched', async () => {
    const chain: Record<string, unknown> = {};
    chain.delete = vi.fn(() => chain);
    const eqMock = vi.fn(() => chain);
    chain.eq = eqMock;
    eqMock.mockImplementationOnce(() => chain).mockImplementationOnce(() => ({ error: null }));
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await expect(
      deleteOwnPendingResumeTailoringDraft(supabase, USER_ID, APPLICATION_ID),
    ).resolves.toBeUndefined();
  });
});
