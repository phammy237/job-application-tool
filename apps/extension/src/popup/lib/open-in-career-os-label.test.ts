import { describe, expect, it } from 'vitest';
import { openInCareerOsLabel } from './open-in-career-os-label';

describe('openInCareerOsLabel', () => {
  it('gives a status-specific hint for the four statuses that are fully determined by status alone', () => {
    expect(openInCareerOsLabel('ACTION_REQUIRED')).toBe(
      'Open Career OS — action required',
    );
    expect(openInCareerOsLabel('ASSESSMENT')).toBe(
      'Open Career OS to complete the assessment',
    );
    expect(openInCareerOsLabel('INTERVIEW')).toBe(
      'Open Career OS to prepare for the interview',
    );
    expect(openInCareerOsLabel('OFFER')).toBe('Open Career OS to review the offer');
  });

  it('falls back to a generic label for every other status — deliberately not guessing at follow-up eligibility', () => {
    for (const status of [
      'SAVED',
      'IN_PROGRESS',
      'APPLIED',
      'APPLICATION_RECEIVED',
      'REJECTED',
      'WITHDRAWN',
      'UNKNOWN',
      null,
    ]) {
      expect(openInCareerOsLabel(status)).toBe('Open in Career OS');
    }
  });

  it('never claims to know follow-up eligibility, which requires date/threshold logic this popup does not have', () => {
    expect(openInCareerOsLabel('APPLIED')).not.toMatch(/follow.?up/i);
    expect(openInCareerOsLabel('APPLICATION_RECEIVED')).not.toMatch(/follow.?up/i);
  });
});
