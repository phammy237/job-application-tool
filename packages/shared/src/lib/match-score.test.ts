import { describe, expect, it } from 'vitest';
import { computeMatchScore, type CriterionEvaluation } from './match-score';
import type { CriteriaWeights } from '../schemas/discovery-scoring-profile';

describe('computeMatchScore', () => {
  it('reproduces the design spec worked example exactly', () => {
    const weights: CriteriaWeights = {
      ROLE_FIT: 10,
      COMPETENCY_FIT: 9,
      SENIORITY_FIT: 8,
      LOCATION_FIT: 7,
      WORK_MODE_FIT: 4,
      EMPLOYMENT_TYPE_FIT: 0,
      OBSERVED_FRESHNESS: 2,
    };
    const evaluations: CriterionEvaluation[] = [
      { criterion: 'ROLE_FIT', fit: 0.95 },
      { criterion: 'COMPETENCY_FIT', fit: 0.8 },
      { criterion: 'SENIORITY_FIT', fit: 1.0 },
      { criterion: 'LOCATION_FIT', fit: 0.7 },
      { criterion: 'WORK_MODE_FIT', fit: null },
      { criterion: 'OBSERVED_FRESHNESS', fit: 1.0 },
    ];

    const result = computeMatchScore(weights, evaluations);

    expect(result.matchScore).toBeCloseTo(87.78, 1);
    expect(result.coverage).toBe(90);
  });

  it('excludes a weight-0 criterion from both match score and coverage entirely', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10, COMPETENCY_FIT: 0 };
    const evaluations: CriterionEvaluation[] = [
      { criterion: 'ROLE_FIT', fit: 1.0 },
      { criterion: 'COMPETENCY_FIT', fit: 0.0 },
    ];
    const result = computeMatchScore(weights, evaluations);
    expect(result.matchScore).toBe(100);
    expect(result.coverage).toBe(100);
    const competency = result.components.find((c) => c.criterion === 'COMPETENCY_FIT');
    expect(competency).toEqual({ criterion: 'COMPETENCY_FIT', weight: 0, known: false, fit: null });
  });

  it('excludes UNKNOWN from the match-score denominator but not from the coverage denominator', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10, LOCATION_FIT: 10 };
    const evaluations: CriterionEvaluation[] = [
      { criterion: 'ROLE_FIT', fit: 0.5 },
      { criterion: 'LOCATION_FIT', fit: null },
    ];
    const result = computeMatchScore(weights, evaluations);
    expect(result.matchScore).toBe(50); // (10*0.5)/10 * 100
    expect(result.coverage).toBe(50); // 10/20 * 100
  });

  it('never treats UNKNOWN as zero fit', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10 };
    const knownLow: CriterionEvaluation[] = [{ criterion: 'ROLE_FIT', fit: 0.01 }];
    const unknown: CriterionEvaluation[] = [{ criterion: 'ROLE_FIT', fit: null }];
    const lowResult = computeMatchScore(weights, knownLow);
    const unknownResult = computeMatchScore(weights, unknown);
    // A known-but-very-low fit produces a real low score; an entirely-unknown criterion produces
    // 0 only because there is nothing else to average — not because it was scored as a mismatch.
    expect(lowResult.matchScore).toBeCloseTo(1, 1);
    expect(unknownResult.coverage).toBe(0);
  });

  it('never divides by zero when nothing is enabled', () => {
    const weights: CriteriaWeights = {};
    const result = computeMatchScore(weights, []);
    expect(result.matchScore).toBe(0);
    expect(result.coverage).toBe(0);
    expect(Number.isFinite(result.matchScore)).toBe(true);
    expect(Number.isFinite(result.coverage)).toBe(true);
  });

  it('never divides by zero when everything enabled is UNKNOWN', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10, LOCATION_FIT: 5 };
    const evaluations: CriterionEvaluation[] = [
      { criterion: 'ROLE_FIT', fit: null },
      { criterion: 'LOCATION_FIT', fit: null },
    ];
    const result = computeMatchScore(weights, evaluations);
    expect(result.matchScore).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 7, COMPETENCY_FIT: 3 };
    const evaluations: CriterionEvaluation[] = [
      { criterion: 'ROLE_FIT', fit: 0.6 },
      { criterion: 'COMPETENCY_FIT', fit: 0.9 },
    ];
    const a = computeMatchScore(weights, evaluations);
    const b = computeMatchScore(weights, evaluations);
    expect(a).toEqual(b);
  });

  it('keeps match score and coverage bounded to [0, 100]', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10 };
    const result = computeMatchScore(weights, [{ criterion: 'ROLE_FIT', fit: 1.0 }]);
    expect(result.matchScore).toBeGreaterThanOrEqual(0);
    expect(result.matchScore).toBeLessThanOrEqual(100);
    expect(result.coverage).toBeGreaterThanOrEqual(0);
    expect(result.coverage).toBeLessThanOrEqual(100);
  });

  it('treats a criterion missing from evaluations as UNKNOWN, not an error', () => {
    const weights: CriteriaWeights = { ROLE_FIT: 10, COMPETENCY_FIT: 10 };
    const result = computeMatchScore(weights, [{ criterion: 'ROLE_FIT', fit: 1.0 }]);
    expect(result.matchScore).toBe(100);
    expect(result.coverage).toBe(50);
  });
});
