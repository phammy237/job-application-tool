import type { ApprovedFactForGeneration } from '@career-os/database';
import type { FieldClassification } from '@career-os/shared';
import { MIN_RELEVANCE_SCORE, RANKING_TOP_N } from '../config';
import { scoreFact, type ScorableJob } from './score-fact';

export interface RankedFact {
  fact: ApprovedFactForGeneration;
  score: number;
}

/**
 * Sorts, floors, and truncates. An empty result means "insufficient facts" to the caller
 * (generate-suggestion.ts) — no Claude call is made in that case, which is the concrete
 * mechanism behind docs/AI_GROUNDING.md's "fact-sparse profile -> honest cannot-answer"
 * requirement (see the Phase 3 plan).
 *
 * Deterministic by construction: `now` is always injected (never Date.now() internally, see
 * score-fact.ts), and ties are broken by (recencyDate desc, id asc) rather than relying on the
 * incoming array order, which depends on the 5-way DB fan-out's per-table query order and is
 * not itself reproducible.
 */
export function rankFacts(
  job: ScorableJob,
  fieldClassification: FieldClassification,
  facts: ApprovedFactForGeneration[],
  options: { now: Date },
): RankedFact[] {
  const scored: RankedFact[] = facts.map((fact) => ({
    fact,
    score: scoreFact(job, fieldClassification, fact, options.now),
  }));

  const aboveFloor = scored.filter((entry) => entry.score >= MIN_RELEVANCE_SCORE);

  aboveFloor.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const recencyA = a.fact.recencyDate ?? '';
    const recencyB = b.fact.recencyDate ?? '';
    if (recencyA !== recencyB) return recencyB.localeCompare(recencyA);
    return a.fact.id.localeCompare(b.fact.id);
  });

  return aboveFloor.slice(0, RANKING_TOP_N);
}
