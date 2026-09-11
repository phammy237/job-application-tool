import { ANSWER_TEXT_CHAR_CAP, FACT_TEXT_CHAR_CAP } from '../config';
import type { ApprovedFactForGeneration } from '@career-os/database';

export interface UnsupportedClaimAnswerInput {
  fieldLabel: string;
  text: string;
}

export interface BuildUnsupportedClaimUserPromptParams {
  answers: UnsupportedClaimAnswerInput[];
  facts: ApprovedFactForGeneration[];
  /** Set on the retry attempt — see generate-unsupported-claims-check.ts's retry-once step. */
  retryReason?: string;
}

export interface BuildUnsupportedClaimUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

export function buildUnsupportedClaimUserPrompt(
  params: BuildUnsupportedClaimUserPromptParams,
): BuildUnsupportedClaimUserPromptResult {
  const { answers, facts, retryReason } = params;

  const answersJson = JSON.stringify(
    answers.map((answer) => ({
      fieldLabel: answer.fieldLabel,
      text: truncate(answer.text, ANSWER_TEXT_CHAR_CAP),
    })),
  );

  const factsJson = JSON.stringify(
    facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      text: truncate(fact.text, FACT_TEXT_CHAR_CAP),
    })),
  );

  const allowedFactIds = new Set(facts.map((fact) => fact.id));

  const parts = [
    `<candidate_answers>\n${answersJson}\n</candidate_answers>`,
    `<candidate_facts>\n${factsJson}\n</candidate_facts>`,
  ];

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. The response array must have exactly ` +
        `${answers.length} entries, one per answer in <candidate_answers>, in the same order, and ` +
        `every id in "citedFactIds" must come from the ids listed in <candidate_facts> above — no ` +
        `others. Try again.`,
    );
  }

  return { userText: parts.join('\n\n'), allowedFactIds };
}
