import { ALL_SCORING_CRITERIA, type CriteriaWeights, type ScoringCriterion } from '../schemas/discovery-scoring-profile';
import type { ScoreComponent } from '../schemas/user-job-match-score';

/** One criterion's evaluated fit for a specific (user, job) pair — `fit: null` means UNKNOWN for
 * this criterion (either the job's relevant attribute couldn't be determined, or the user hasn't
 * expressed a preference for the specific value the job has). Never `0` for "don't know". */
export interface CriterionEvaluation {
  criterion: ScoringCriterion;
  fit: number | null;
}

export interface MatchScoreResult {
  matchScore: number;
  coverage: number;
  components: ScoreComponent[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The Match-Score/Coverage math, exactly as specified (docs/JOB_DISCOVERY.md "Match-score math"
 * / "Coverage"):
 *
 *   matchScore = Σ(weight·fit) / Σ(weight for KNOWN enabled criteria) × 100
 *   coverage   = Σ(weight for KNOWN enabled)  / Σ(weight for ALL enabled)  × 100
 *
 * A criterion with user weight 0 is disabled and excluded from BOTH sums entirely (not scored as
 * zero-fit, not counted toward coverage either — the user turned it off, it isn't "missing
 * data"). A criterion with weight > 0 but `fit: null` (UNKNOWN) is excluded from the match-score
 * numerator/denominator but DOES count toward the coverage denominator (it's an enabled
 * criterion Career OS simply couldn't evaluate for this job) — that's what makes Coverage fall
 * when provider data is sparse.
 *
 * Never divides by zero: if literally no criterion is both enabled and known, matchScore is 0
 * (not NaN/thrown) — a job Career OS can say nothing about defaults to the bottom of the
 * ranking, never the top. If no criterion is enabled at all, coverage is likewise 0 rather than
 * an undefined 0/0. `components` preserves every criterion's weight/known/fit so a score can be
 * reproduced or explained exactly by D5's "See details" without recomputation.
 */
export function computeMatchScore(
  weights: CriteriaWeights,
  evaluations: readonly CriterionEvaluation[],
): MatchScoreResult {
  const byCriterion = new Map(evaluations.map((evaluation) => [evaluation.criterion, evaluation]));

  const components: ScoreComponent[] = [];
  let weightedFitSum = 0;
  let knownEnabledWeightSum = 0;
  let allEnabledWeightSum = 0;

  for (const criterion of ALL_SCORING_CRITERIA) {
    const weight = weights[criterion] ?? 0;

    if (weight === 0) {
      components.push({ criterion, weight: 0, known: false, fit: null });
      continue;
    }

    allEnabledWeightSum += weight;
    const fit = byCriterion.get(criterion)?.fit ?? null;

    if (fit === null) {
      components.push({ criterion, weight, known: false, fit: null });
      continue;
    }

    knownEnabledWeightSum += weight;
    weightedFitSum += weight * fit;
    components.push({ criterion, weight, known: true, fit });
  }

  const matchScore = knownEnabledWeightSum > 0 ? (weightedFitSum / knownEnabledWeightSum) * 100 : 0;
  const coverage = allEnabledWeightSum > 0 ? (knownEnabledWeightSum / allEnabledWeightSum) * 100 : 0;

  return {
    matchScore: clamp(round2(matchScore), 0, 100),
    coverage: clamp(round2(coverage), 0, 100),
    components,
  };
}
