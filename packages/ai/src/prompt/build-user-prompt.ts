import type { FieldClassification } from '@career-os/shared';
import { FACT_TEXT_CHAR_CAP, JOB_DESCRIPTION_CHAR_CAP } from '../config';
import type { RankedFact } from '../retrieval/rank-facts';
import type { ScorableJob } from '../retrieval/score-fact';

export interface BuildUserPromptParams {
  job: Pick<ScorableJob, 'title'> & { company?: string | null };
  fieldLabel: string;
  fieldClassification: FieldClassification;
  rankedFacts: RankedFact[];
  /** Set on the retry attempt to restate the specific rejection reason and re-assert the
   * allowed id list — see generate-suggestion.ts's retry-once step. */
  retryReason?: string;
}

export interface BuildUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * The only place job/fact content appears in the request. Truncation is applied here, after
 * retrieval/ranking has already selected which facts to include — it trims a fact's text, it
 * never drops a selected fact from the prompt. Returns `allowedFactIds`, the exact set of ids
 * placed in <candidate_facts>, which contract/validate-contract.ts uses to reject any
 * `sourceFactIds` entry the model didn't actually receive (defeats both a hallucinated id and
 * one smuggled in via prompt injection).
 */
export function buildUserPrompt(params: BuildUserPromptParams): BuildUserPromptResult {
  const { job, fieldLabel, fieldClassification, rankedFacts, retryReason } = params;

  const factsJson = JSON.stringify(
    rankedFacts.map(({ fact }) => ({
      id: fact.id,
      category: fact.category,
      text: truncate(fact.text, FACT_TEXT_CHAR_CAP),
    })),
  );

  const allowedFactIds = new Set(rankedFacts.map(({ fact }) => fact.id));

  const jobLines = [`Title: ${job.title ?? 'Unknown'}`];
  if (job.company) jobLines.push(`Company: ${job.company}`);

  const parts = [
    `<job_posting>\n${truncate(jobLines.join('\n'), JOB_DESCRIPTION_CHAR_CAP)}\n</job_posting>`,
    `<candidate_facts>\n${factsJson}\n</candidate_facts>`,
    `<field>\nLabel: "${fieldLabel}"\nClassification: ${fieldClassification}\n</field>`,
  ];

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Every id in "sourceFactIds" must ` +
        `come from the ids listed in <candidate_facts> above — no others. Try again.`,
    );
  }

  return { userText: parts.join('\n\n'), allowedFactIds };
}
