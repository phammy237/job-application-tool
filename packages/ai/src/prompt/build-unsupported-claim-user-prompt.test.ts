import type { ApprovedFactForGeneration } from '@career-os/database';
import { describe, expect, it } from 'vitest';
import { ANSWER_TEXT_CHAR_CAP, FACT_TEXT_CHAR_CAP } from '../config';
import { buildUnsupportedClaimUserPrompt } from './build-unsupported-claim-user-prompt';

const FACT: ApprovedFactForGeneration = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceTable: 'experiences',
  category: 'EXPERIENCE',
  text: 'Led the Kubernetes migration at Acme.',
  tags: [],
  recencyDate: '2025-01-01',
  isOngoing: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ANSWER = {
  fieldLabel: 'Describe a project you led',
  text: 'I led the Kubernetes migration.',
};

describe('buildUnsupportedClaimUserPrompt — answers and facts as untrusted data', () => {
  it('places answer content only inside <candidate_answers>, never in a static section', () => {
    const nonce = 'NONCE-IGNORE-ALL-PRIOR-INSTRUCTIONS-8f3a2b';
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [{ ...ANSWER, text: nonce }],
      facts: [FACT],
    });
    expect(userText).toContain('<candidate_answers>');
    expect(userText.indexOf(nonce)).toBeGreaterThan(
      userText.indexOf('<candidate_answers>'),
    );
    expect(userText.indexOf(nonce)).toBeLessThan(
      userText.indexOf('</candidate_answers>'),
    );
  });

  it('returns allowedFactIds as exactly the ids placed in <candidate_facts>', () => {
    const { allowedFactIds } = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [FACT],
    });
    expect(allowedFactIds).toEqual(new Set([FACT.id]));
  });

  it('includes every answer field label and text', () => {
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [FACT],
    });
    expect(userText).toContain(ANSWER.fieldLabel);
    expect(userText).toContain(ANSWER.text);
  });

  it('includes every fact id, category, and text', () => {
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [FACT],
    });
    expect(userText).toContain(FACT.id);
    expect(userText).toContain(FACT.category as string);
    expect(userText).toContain(FACT.text);
  });

  it('truncates answer text beyond ANSWER_TEXT_CHAR_CAP', () => {
    const longText = 'x'.repeat(ANSWER_TEXT_CHAR_CAP + 500);
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [{ ...ANSWER, text: longText }],
      facts: [FACT],
    });
    expect(userText).not.toContain(longText);
    expect(userText).toContain('x'.repeat(ANSWER_TEXT_CHAR_CAP));
  });

  it('truncates fact text beyond FACT_TEXT_CHAR_CAP', () => {
    const longFactText = 'y'.repeat(FACT_TEXT_CHAR_CAP + 500);
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [{ ...FACT, text: longFactText }],
    });
    expect(userText).not.toContain(longFactText);
  });

  it('appends the retry reason, with the exact expected answer count, only when provided', () => {
    const withoutRetry = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [FACT],
    });
    expect(withoutRetry.userText).not.toContain('Your previous attempt was rejected');

    const withRetry = buildUnsupportedClaimUserPrompt({
      answers: [ANSWER],
      facts: [FACT],
      retryReason: 'the response was not valid JSON',
    });
    expect(withRetry.userText).toContain('Your previous attempt was rejected');
    expect(withRetry.userText).toContain('exactly 1 entries');
  });

  it('never leaks a generatedAnswerId into the prompt — only fieldLabel and text are sent', () => {
    const { userText } = buildUnsupportedClaimUserPrompt({
      answers: [{ ...ANSWER, generatedAnswerId: 'should-not-appear' } as never],
      facts: [FACT],
    });
    expect(userText).not.toContain('should-not-appear');
  });
});
