import type { ApprovedFactForGeneration } from '@career-os/database';
import { describe, expect, it } from 'vitest';
import { FACT_TEXT_CHAR_CAP } from '../config';
import type { RankedFact } from '../retrieval/rank-facts';
import { buildSystemPrompt } from './build-system-prompt';
import { buildUserPrompt } from './build-user-prompt';

function rankedFact(overrides: Partial<ApprovedFactForGeneration>): RankedFact {
  return {
    score: 0.9,
    fact: {
      id: '11111111-1111-4111-8111-111111111111',
      sourceTable: 'experiences',
      category: 'EXPERIENCE',
      text: 'Built the payments service.',
      tags: [],
      recencyDate: null,
      isOngoing: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

describe('buildUserPrompt — job text as untrusted data (injection regression guard)', () => {
  it('never places job content in the static system prompt, only inside <job_posting> in the user turn', () => {
    const nonce = 'NONCE-IGNORE-ALL-PRIOR-INSTRUCTIONS-8f3a2b';
    const { userText } = buildUserPrompt({
      job: { title: nonce, company: null },
      fieldLabel: 'Why do you want to work here?',
      fieldClassification: 'FREE_RESPONSE',
      rankedFacts: [],
    });

    const systemPrompt = buildSystemPrompt();
    expect(systemPrompt).not.toContain(nonce);
    expect(userText).toContain(nonce);
    expect(userText).toContain('<job_posting>');
  });
});

describe('buildUserPrompt — allowedFactIds', () => {
  it('exactly matches the ids placed in <candidate_facts>', () => {
    const facts = [
      rankedFact({ id: 'fact-a' }),
      rankedFact({ id: 'fact-b' }),
    ];
    const { allowedFactIds } = buildUserPrompt({
      job: { title: 'Engineer', company: 'Acme' },
      fieldLabel: 'Describe a project.',
      fieldClassification: 'EXPERIENCE',
      rankedFacts: facts,
    });
    expect(allowedFactIds).toEqual(new Set(['fact-a', 'fact-b']));
  });

  it('is empty when no facts are ranked', () => {
    const { allowedFactIds } = buildUserPrompt({
      job: { title: 'Engineer', company: 'Acme' },
      fieldLabel: 'Describe a project.',
      fieldClassification: 'EXPERIENCE',
      rankedFacts: [],
    });
    expect(allowedFactIds.size).toBe(0);
  });
});

describe('buildUserPrompt — truncation', () => {
  it('truncates a fact text over the cap, never drops the fact entirely', () => {
    const longText = 'x'.repeat(FACT_TEXT_CHAR_CAP + 500);
    const { userText, allowedFactIds } = buildUserPrompt({
      job: { title: 'Engineer', company: 'Acme' },
      fieldLabel: 'Describe a project.',
      fieldClassification: 'EXPERIENCE',
      rankedFacts: [rankedFact({ id: 'long-fact', text: longText })],
    });
    expect(allowedFactIds.has('long-fact')).toBe(true);
    expect(userText).not.toContain(longText);
    expect(userText.length).toBeLessThan(longText.length + 1000);
  });
});

describe('buildUserPrompt — retry reason', () => {
  it('includes the retry reason and a reminder about the allowed id list when provided', () => {
    const { userText } = buildUserPrompt({
      job: { title: 'Engineer', company: 'Acme' },
      fieldLabel: 'Describe a project.',
      fieldClassification: 'EXPERIENCE',
      rankedFacts: [rankedFact({})],
      retryReason: 'unsupported_claims_present',
    });
    expect(userText).toContain('unsupported_claims_present');
  });

  it('omits the retry section entirely on a first attempt', () => {
    const { userText } = buildUserPrompt({
      job: { title: 'Engineer', company: 'Acme' },
      fieldLabel: 'Describe a project.',
      fieldClassification: 'EXPERIENCE',
      rankedFacts: [rankedFact({})],
    });
    expect(userText).not.toContain('previous attempt');
  });
});
