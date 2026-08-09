import { MAX_OUTPUT_TOKENS, MODEL_ID } from '../config';
import { getAnthropicClient } from './client';

/**
 * Hand-written JSON Schema mirroring generatedAnswerContractSchema (packages/shared), rather
 * than the SDK's `zodOutputFormat` helper — that helper requires Zod v4's internals, and this
 * monorepo is pinned to Zod v3 everywhere (packages/shared, packages/database). This schema
 * only needs to match closely enough to constrain the model's output shape; the authoritative
 * check is still the independent Zod v3 parse in contract/validate-contract.ts.
 */
const GENERATED_ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    sourceFactIds: { type: 'array', items: { type: 'string' } },
    reasoningSummary: { type: 'string' },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    requiresUserReview: { type: 'boolean' },
  },
  required: [
    'answer',
    'confidence',
    'sourceFactIds',
    'reasoningSummary',
    'unsupportedClaims',
    'requiresUserReview',
  ],
  additionalProperties: false,
} as const;

export type CallClaudeResult =
  | { status: 'ok'; rawText: string }
  | { status: 'refusal'; category: string | null }
  | { status: 'provider_error'; message: string };

/**
 * Wraps a single structured-JSON generation call. Deliberately has no `tools` array — the
 * single biggest blast-radius reducer against prompt injection in the job/fact content (see
 * docs/AI_GROUNDING.md §2/§6 and the Phase 3 plan): there is nothing for injected text to
 * invoke. `output_config.format` constrains the response shape at the API level as a second,
 * independent layer beneath the Zod validation in contract/validate-contract.ts. Thinking is
 * disabled — this is a short, single-turn structured-output call, not a task that benefits
 * from adaptive reasoning.
 */
export async function callClaudeForSuggestion(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: GENERATED_ANSWER_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}
