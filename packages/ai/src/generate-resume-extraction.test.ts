import type { CareerOsSupabaseClient } from '@career-os/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incrementOwnAiRequestUsage: vi.fn(),
  decrementOwnAiRequestUsage: vi.fn(),
  recordAiUsageEvent: vi.fn(),
  callClaudeForResumeExtraction: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  incrementOwnAiRequestUsage: mocks.incrementOwnAiRequestUsage,
  decrementOwnAiRequestUsage: mocks.decrementOwnAiRequestUsage,
  recordAiUsageEvent: mocks.recordAiUsageEvent,
}));

vi.mock('./claude/call-claude', () => ({
  callClaudeForResumeExtraction: mocks.callClaudeForResumeExtraction,
}));

const { generateResumeExtraction } = await import('./generate-resume-extraction');

const FAKE_SUPABASE = {} as unknown as CareerOsSupabaseClient;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_TEXT = 'Jane Doe\nEXPERIENCE\nSoftware Engineer, Acme Corp\n- Built things';

const ALLOWED_USAGE = {
  allowed: true,
  aiRequestsThisPeriod: 1,
  aiRequestLimit: 150,
  aiRequestPeriodStartedAt: '2026-01-01T00:00:00.000Z',
};

function validExtractionJson() {
  return JSON.stringify({
    experience: [
      {
        company: 'Acme Corp',
        title: 'Software Engineer',
        location: null,
        dateRangeText: null,
        bullets: ['Built things'],
        uncertain: false,
      },
    ],
    education: [],
    projects: [],
    skills: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.incrementOwnAiRequestUsage.mockResolvedValue(ALLOWED_USAGE);
  mocks.decrementOwnAiRequestUsage.mockResolvedValue(undefined);
  mocks.recordAiUsageEvent.mockResolvedValue(undefined);
});

describe('generateResumeExtraction', () => {
  it('returns rate_limited and never calls Claude when quota is exhausted', async () => {
    mocks.incrementOwnAiRequestUsage.mockResolvedValue({ ...ALLOWED_USAGE, allowed: false });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result.status).toBe('rate_limited');
    expect(mocks.callClaudeForResumeExtraction).not.toHaveBeenCalled();
  });

  it('returns the grounded, structured result on success', async () => {
    mocks.callClaudeForResumeExtraction.mockResolvedValue({
      status: 'ok',
      rawText: validExtractionJson(),
    });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });

  it('drops a fabricated (ungrounded) entry rather than rejecting the whole response', async () => {
    mocks.callClaudeForResumeExtraction.mockResolvedValue({
      status: 'ok',
      rawText: JSON.stringify({
        experience: [
          {
            company: 'A Company Never In The Text',
            title: 'Engineer',
            location: null,
            dateRangeText: null,
            bullets: [],
            uncertain: false,
          },
        ],
        education: [],
        projects: [],
        skills: [],
      }),
    });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it('retries once on malformed output, then succeeds', async () => {
    mocks.callClaudeForResumeExtraction
      .mockResolvedValueOnce({ status: 'ok', rawText: 'not json' })
      .mockResolvedValueOnce({ status: 'ok', rawText: validExtractionJson() });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result.status).toBe('ok');
    expect(mocks.callClaudeForResumeExtraction).toHaveBeenCalledTimes(2);
  });

  it('returns invalid_output after both attempts fail shape validation', async () => {
    mocks.callClaudeForResumeExtraction.mockResolvedValue({ status: 'ok', rawText: 'not json' });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result).toEqual({ status: 'invalid_output' });
    expect(mocks.callClaudeForResumeExtraction).toHaveBeenCalledTimes(2);
  });

  it('refunds the reserved quota unit on a provider_error (real-incident-class regression, consistent with every other pipeline)', async () => {
    mocks.callClaudeForResumeExtraction.mockResolvedValue({
      status: 'provider_error',
      message: 'network timeout',
    });

    const result = await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    expect(result).toEqual({ status: 'provider_error', message: 'network timeout' });
    expect(mocks.decrementOwnAiRequestUsage).toHaveBeenCalledWith(FAKE_SUPABASE, USER_ID);
  });

  it('never includes the résumé text itself in the recorded usage telemetry', async () => {
    mocks.callClaudeForResumeExtraction.mockResolvedValue({
      status: 'ok',
      rawText: validExtractionJson(),
    });

    await generateResumeExtraction(FAKE_SUPABASE, USER_ID, RESUME_TEXT);

    const [, , eventInput] = mocks.recordAiUsageEvent.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(JSON.stringify(eventInput)).not.toContain('Acme Corp');
    expect(JSON.stringify(eventInput)).not.toContain(RESUME_TEXT);
  });
});
