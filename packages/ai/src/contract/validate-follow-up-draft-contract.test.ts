import { describe, expect, it } from 'vitest';
import {
  containsFabricationRiskPhrase,
  validateFollowUpDraftContract,
} from './validate-follow-up-draft-contract';

function json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ subject: 'Hi', body: 'A polite follow-up.', ...overrides });
}

describe('validateFollowUpDraftContract', () => {
  it('accepts a clean, well-formed draft', () => {
    const result = validateFollowUpDraftContract(json());
    expect(result).toEqual({
      status: 'ok',
      draft: { subject: 'Hi', body: 'A polite follow-up.' },
    });
  });

  it('accepts a null subject', () => {
    const result = validateFollowUpDraftContract(json({ subject: null }));
    expect(result.status).toBe('ok');
  });

  it('rejects malformed JSON', () => {
    expect(validateFollowUpDraftContract('not json')).toEqual({
      status: 'rejected',
      reason: 'validation_failed',
    });
  });

  it('rejects a schema violation (missing body)', () => {
    expect(validateFollowUpDraftContract(JSON.stringify({ subject: 'Hi' }))).toEqual({
      status: 'rejected',
      reason: 'validation_failed',
    });
  });

  it.each([
    'I really enjoyed speaking with your recruiter last week.',
    'Following up on our call from Tuesday.',
    'Thanks for the phone screen last week.',
    'I was referred by a friend at your company.',
    'It was great meeting the team during our interview.',
    'I completed the assessment you sent over.',
    'Following up after our conversation.',
  ])('rejects a fabricated-interaction claim: %s', (body) => {
    expect(validateFollowUpDraftContract(json({ body }))).toEqual({
      status: 'rejected',
      reason: 'fabricated_interaction_claim',
    });
  });

  it('is case-insensitive when scanning for fabrication-risk phrases', () => {
    expect(
      validateFollowUpDraftContract(json({ body: 'REFERRED BY a colleague of yours.' })),
    ).toEqual({ status: 'rejected', reason: 'fabricated_interaction_claim' });
  });

  it('accepts an ordinary, non-fabricating follow-up body', () => {
    const result = validateFollowUpDraftContract(
      json({
        body: 'I wanted to check in on the status of my application. Thank you for your time.',
      }),
    );
    expect(result.status).toBe('ok');
  });
});

describe('containsFabricationRiskPhrase', () => {
  it('returns null for clean text', () => {
    expect(
      containsFabricationRiskPhrase('Just checking in on my application.'),
    ).toBeNull();
  });

  it('returns the matched phrase for flagged text', () => {
    expect(containsFabricationRiskPhrase('I spoke with your team.')).toBe('spoke with');
  });
});
