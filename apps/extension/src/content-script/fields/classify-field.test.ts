import { describe, expect, it } from 'vitest';
import { classifyField } from './classify-field';
import { classificationFixtures } from './fixtures';

describe('classifyField', () => {
  for (const fixture of classificationFixtures) {
    it(`classifies: ${fixture.description}`, () => {
      const result = classifyField(fixture.signals);
      expect(result.classification).toBe(fixture.expected);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  }

  it('never classifies as AUTHENTICATION — those fields must be excluded before classification, not classified', () => {
    for (const fixture of classificationFixtures) {
      expect(classifyField(fixture.signals).classification).not.toBe('AUTHENTICATION');
    }
  });
});
