import { describe, expect, it } from 'vitest';
import { actionAssistanceFor } from './action-assistance';
import { nextActionTypeSchema } from './next-action';

describe('actionAssistanceFor', () => {
  it('maps CONSIDER_FOLLOW_UP to FOLLOW_UP_DRAFT', () => {
    expect(actionAssistanceFor('CONSIDER_FOLLOW_UP')).toBe('FOLLOW_UP_DRAFT');
  });

  it('maps PREPARE_INTERVIEW to INTERVIEW_PREP', () => {
    expect(actionAssistanceFor('PREPARE_INTERVIEW')).toBe('INTERVIEW_PREP');
  });

  it('maps every other NextActionType to null — no AI assistance for every action just to make the enum symmetrical', () => {
    const others = nextActionTypeSchema.options.filter(
      (type) => type !== 'CONSIDER_FOLLOW_UP' && type !== 'PREPARE_INTERVIEW',
    );
    expect(others.length).toBeGreaterThan(0);
    for (const type of others) {
      expect(actionAssistanceFor(type)).toBeNull();
    }
  });
});
